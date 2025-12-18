const mongoose = require('mongoose');

mongoose.connect(`mongodb://localhost:27017/hackathonTest2`);

const userSchema = mongoose.Schema({
    username : String ,
    email : String,
    password : String,
    isAdmin: { type: Boolean, default: false },
    profilePic : {
        type:String,
        default:"defaultPhoto.webp",
    },
    garbageRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'garbage'
    }],
    recycleRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'recycleItem'
    }]

})

module.exports = mongoose.model("user",userSchema);