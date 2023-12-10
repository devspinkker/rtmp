const express = require("express")
const CreateClips = require("../controllers/CreateClips")
const Routes = express.Router()

Routes.post("/", CreateClips)

module.exports = Routes