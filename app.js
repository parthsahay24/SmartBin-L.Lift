// Load environment variables from the .env file
require('dotenv').config();

const express= require("express");
const app=express();
const path=require("path");
const fs = require('fs');
const nodemailer = require('nodemailer');// module for sending emails
const morgan = require('morgan');       // HTTP request logger middleware

//--------------------------------------------------------------------------------------------------------------------------------------


//config folder
const upload = require('./config/multerconfig');
const { 
    getAddressFromCoordinates2, 
    findNearestRecyclingCenter 
} = require('./config/recyclingConfig');

const { 
  getAddressFromCoordinates1, 
  findNearestGarbageCenter 
} = require('./config/garbageConfig');


//---------------------------------------------------------------------------------------------------------------------------------------

//for Login/signIn
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

//---------------------------------------------------------------------------------------------------------------------------------------

//database
const userModel = require('./models/user');
const adminModel = require("./models/admin");
const { ADMIN_PASSKEY } = process.env;
const recycleItem = require('./models/recycleItem');
const garbage = require('./models/garbage');

//in this line the email username and password from environment variables are stored in emailUser and emailPass.
const { EMAIL_USER: emailUser, EMAIL_PASS: emailPass } = process.env;
//const { OPENCAGE_API_KEY : opencageApiKey} = process.env;


// middleware for handling file uploads
const multer = require('multer');      

//-----------------------------------------------------------------------------------------------------------------------------------------

// log the details of incoming HTTP requests in a combined format, which includes details like IP, method, URL, status code, etc.
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));
app.set("view engine","ejs");
app.use(cookieParser());

//-----------------------------------------------------------------------------------------------------------------------------------------

//home page
app.get("/",function(req,res){
    res.render("homepage");
})
app.get('/garbageImage',(req,res)=>{
  res.render('uploadG');
})
app.get('/recycleImage',(req,res)=>{
    res.render('uploadR');
})


//create user interface
app.get("/userCreate",(req,res)=>{
    res.render("userCreate");
})

//creating and adding userData in database
app.post('/userCreate',async (req,res)=>{
    let {username,email,password} = req.body;

    let user = await userModel.findOne({email});           //or you can write ({email:email})
    if(user) return res.status(500).send("User already registered");

    bcrypt.genSalt(10,(err,salt)=>{
        bcrypt.hash(password,salt,async (err,hash)=>{
            let CreatedUser = await userModel.create({
                username,
                password:hash,
                email,
            })

            let token = jwt.sign({email},"secret");
            res.cookie("token",token);
            res.redirect('/userProfile');
        })
    })
})

//User login interface
app.get("/userLogin",(req,res)=>{
    res.render("userLogin");
})

//checking if the user has an account and aunthenticating it
app.post("/userLogin",async (req,res)=>{
    let loginUser = await userModel.findOne({email:req.body.email});
    if(!loginUser) return res.send("Something is wrong");

    bcrypt.compare(req.body.password, loginUser.password, (err,result)=>{
        if (err) {
            // Handle potential errors during password comparison
            console.error(err);
            return res.status(500).send("Internal Server Error"); // More informative error message
        }
        
        if(result){
            let token = jwt.sign({email:loginUser.email},"secret");
            res.cookie("token",token);

            res.redirect('/userProfile');
        }
        else return res.send("Something is wrong");
    })
})


//user Profile page
app.get('/userProfile',isLoggedInAsUser ,async function(req,res){
  try{
    let user = await userModel.findOne({email:req.user.email}).populate('garbageRequests').populate('recycleRequests');
    res.render("userProfile",{user});
  }  catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
})

app.get('/adminCreate',(req,res)=>{
    res.render('adminCreate');
})

app.post('/adminCreate', async (req, res) => {
    const { username, email, password, passkey } = req.body;
  
    if (passkey !== ADMIN_PASSKEY) {
      return res.status(401).send('Unauthorized');
    }
  
    let admin = await adminModel.findOne({ email });
    if (admin) {
      return res.status(500).send('Admin already registered');
    }
  
    bcrypt.genSalt(10, (err, salt) => {
      bcrypt.hash(password, salt, async (err, hash) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Internal Server Error');
        }
  
        let newAdmin = await adminModel.create({
          username,
          email,
          password: hash
        });

        let token = jwt.sign({email},"secret");
            res.cookie("token",token);
            res.render("adminProfile",{newAdmin});
  
        // try {
        //   await newAdmin.save();
        //   res.send('Admin created successfully');
        // } catch (err) {
        //   console.error(err);
        //   res.status(500).send('Error creating admin');
        // }
      });
    });
  });

app.get("/adminLogin",(req,res)=>{
  res.render('adminLogin');
})

app.post('/adminLogin', async (req, res) => {
    const { email, password, passkey } = req.body;
  
    if (passkey !== ADMIN_PASSKEY) {
      return res.status(401).send('Unauthorized');
    }
  
    const admin = await adminModel.findOne({ email });
    if (!admin) {
      return res.status(400).send('Invalid email or password');
    }
  
    bcrypt.compare(password, admin.password, (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Internal Server Error');
      }
  
      if (result) {
        const token = jwt.sign({ email: admin.email }, 'secret');
        res.cookie('adminToken', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        res.render('adminProfile',{admin});
      } else {
        return res.status(400).send('Invalid email or password');
      }
    });
})


app.get('/adminProfile',isLoggedInAsAdmin ,async function(req,res){
  let admin = await adminModel.findOne({email:req.admin.email});
  res.render("adminProfile",{admin});
  // res.send("hii");
})

app.get('/admin/recycling-requests', isLoggedInAsAdmin, async (req, res) => {
  try {
      const recycleRequests = await recycleItem.find().populate('user', 'username');
      res.json(recycleRequests);
  } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Error fetching recycling requests' });
  }
});



app.post('/admin/update-recycling-status', isLoggedInAsAdmin, async (req, res) => {
  const { requestId } = req.body;
  
  try {
      const updatedRequest = await recycleItem.findByIdAndUpdate(requestId, { status: 'completed' }, { new: true });

      if (!updatedRequest) {
          return res.status(404).json({ success: false, message: 'Request not found' });
      }

      res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Error updating status' });
  }
});


//logout (clearing cookie)
app.get("/logout",(req,res)=>{
    res.cookie("token","");
    res.redirect("/");
})


// Endpoint to handle image and location data
app.post('/uploadGarbageImg',isLoggedInAsUser, upload.single('image'), async(req, res) => {
    if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const lat = parseFloat(req.body.latitude);
    const lon = parseFloat(req.body.longitude);
    const manualAddress = req.body.manualAddress;
    const mapsLink = `https://www.google.com/maps?q=${lat},${lon}`;


    // check lat and long values
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ success: false, message: 'Invalid latitude or longitude' });
    }

    const image = req.file;
    const nearestCenter = findNearestGarbageCenter(lat, lon);

    if (!nearestCenter) {
    return res.status(500).json({ success: false, message: 'No recycling centers found' });
    }

    // to get human-readable address
    const address = await getAddressFromCoordinates1(lat, lon);
    
    try {
      const user = await userModel.findOne({ email: req.user.email });
      const newGarbageRequest = new garbage({
          user: user._id,
          description: `Garbage reported at ${manualAddress}`,
          location: `${lat}, ${lon}`
      });

      await newGarbageRequest.save();

      user.garbageRequests.push(newGarbageRequest._id);
      await user.save();

      // Email sending logic here (unchanged)

      res.json({ success: true, message: 'Image and location received', address });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Failed to process request' });
    }

    // set up email transport
    const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: emailUser, pass: emailPass },
    tls: { rejectUnauthorized: false }
    });

    // define email options
    const mailOptions = {
    from: emailUser,
    to: nearestCenter.email,
    cc: req.user.email,
    subject: 'Garbage Report',
    text: `Garbage reported at: ${manualAddress || address}
  Location: ${address}
  View on map: ${mapsLink}
  Nearest center: ${nearestCenter.name}
  User: ${req.user.username} (${req.user.email})`,
    attachments: [{ filename: image.originalname, path: image.path }]
    };

    // send email
    transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to send email' });
    }

    console.log('Email sent: ' + info.response);
    fs.unlink(image.path, (err) => {
        if (err) console.error('Error deleting file:', err);
    });
    res.json({ success: true, message: 'Image and location received' });
    });
});

//admin part getting the rquests by the users
app.get('/admin/garbage-requests', isLoggedInAsAdmin, async (req, res) => {
  try {
      const garbageRequests = await garbage.find().populate('user', 'username');
      res.json(garbageRequests);
  } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Error fetching garbage requests' });
  }
});

//acknowldgeing part of the requests from the admin page
app.post('/admin/update-garbage-status', isLoggedInAsAdmin, async (req, res) => {
  const { requestId } = req.body;
  
  try {
      const updatedRequest = await garbage.findByIdAndUpdate(
          requestId,
          { status: 'completed' },
          { new: true }
      );
      
      if (!updatedRequest) {
          return res.status(404).json({ success: false, message: 'Request not found' });
      }
      
      res.json({ success: true, message: 'Garbage request status updated successfully' });
  } catch (error) {
      console.error("Error updating garbage request status:", error);
      res.status(500).json({ success: false, message: 'Error updating garbage request status' });
  }
});


app.post('/uploadRecycleImg',isLoggedInAsUser, upload.single('image'), async(req, res) => {
  if (!req.file) {
  return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const lat = parseFloat(req.body.latitude);
  const lon = parseFloat(req.body.longitude);

  // check lat and long values
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
  return res.status(400).json({ success: false, message: 'Invalid latitude or longitude' });
  }

  const image = req.file;
  const nearestCenter = findNearestRecyclingCenter(lat, lon);

  if (!nearestCenter) {
  return res.status(500).json({ success: false, message: 'No recycling centers found' });
  }

  // to get human-readable address
  const address = await getAddressFromCoordinates2(lat, lon);

  try {
    const user = await userModel.findOne({ email: req.user.email });
    const newRecycleRequest = new recycleItem({
        user: user._id,
        description: `Items to be Recycled at reported at ${address}`,
        location: `${lat}, ${lon}`
    });

    await newRecycleRequest.save();

    user.recycleRequests.push(newRecycleRequest._id);
    await user.save();

    // Email sending logic here (unchanged)

    res.json({ success: true, message: 'Image and location received', address });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }


  // set up email transport
  const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: emailUser, pass: emailPass },
  tls: { rejectUnauthorized: false }
  });

  // define email options
  const mailOptions = {
  from: emailUser,
  to: nearestCenter.email,
  subject: 'Recycling Items Report',
  text: `Items to be recycled reported at latitude: ${address}\nLatitude: ${lat}, Longitude: ${lon}\nNearest recycling center: ${nearestCenter.name}.  ${req.user.email}  request from ${req.user.username}`,
  attachments: [{ filename: image.originalname, path: image.path }]
  };

  // send email
  transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
  console.error(error);
  return res.status(500).json({ success: false, message: 'Failed to send email' });
  }

  console.log('Email sent: ' + info.response);
  fs.unlink(image.path, (err) => {
      if (err) console.error('Error deleting file:', err);
  });
  res.json({ success: true, message: 'Image and location received' });
  });
});

app.get('/map',(req,res)=>{
  res.render('map');
})

app.get('/payment', (req, res) => {
  res.render('index');
})

app.post('/checkout', async (req, res) => {
  const session = await stripe.checkout.sessions.create({
      line_items: [
          {
              price_data: {
                  currency: 'INR',
                  product_data: {
                      name: 'fund Amount'
                  },
                  unit_amount: 50 * 100
              },
              quantity: 1
          },
              
      ],
      mode: 'payment',
     
      
      success_url: `${process.env.BASE_URL}/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`
  })

  res.redirect(session.url);
})

app.get('/complete', async (req, res) => {
  const result = Promise.all([
      stripe.checkout.sessions.retrieve(req.query.session_id, { expand: ['payment_intent.payment_method'] }),
      stripe.checkout.sessions.listLineItems(req.query.session_id)
  ])

  console.log(JSON.stringify(await result))

  res.render('paymentSuccess')
})

app.get('/cancel', (req, res) => {
  res.redirect('/')
})

app.get('/chatbot', (req, res) => {
    res.render('chatbot', { chatbotUrl: 'http://localhost:8000/chatbot' });
});

function isLoggedInAsUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
      return res.redirect("/userLogin");
  }
  
  try {
      const data = jwt.verify(token, "secret");
      userModel.findOne({email: data.email})
          .then(user => {
              if (!user) {
                  res.clearCookie("token");
                  return res.redirect("/userLogin");
              }
              req.user = user;
              next();
          })
          .catch(err => {
              console.error(err);
              res.clearCookie("token");
              return res.redirect("/userLogin");
          });
  } catch (error) {
      res.clearCookie("token");
      return res.redirect("/userLogin");
  }
}

function isLoggedInAsAdmin(req, res, next) {
  const token = req.cookies.adminToken;
  if (!token) {
    return res.redirect('/adminLogin');
  }

  try {
    const data = jwt.verify(token, 'secret');
    req.admin = data;

    // Check if the user is an admin
    // adminModel.findOne({ email: data.email }, (err, admin) => {
    //   if (err) {
    //     console.error(err);
    //     return res.status(500).send('Internal Server Error');
    //   }

    //   if (!admin) {
    //     res.clearCookie('adminToken');
    //     return res.redirect('/adminLogin');
    //   }

      //next();
    //});

    next();
  } catch (error) {
    res.clearCookie('adminToken');
    return res.redirect('/adminLogin');
  }
}

app.listen(3000,function(){
    console.log("running");
})

//this is for checking purpose
console.log('EMAIL_USER:', emailUser);
console.log('EMAIL_PASS:', emailPass);