const { TOKENPASSWORD } = require("../config")
const jwt = require("jsonwebtoken");

module.exports = async (req, res, next) => {

    const authorization = req.get('authorization')
    let token = ""
    if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
        token = authorization.substring(7)
    } else {
        return res.status(401).json({ error: 'token missing or invalid' })
        next()
    }
    try {
        const decodetoken = jwt.verify(token, TOKENPASSWORD)
        req.idUser = decodetoken.id
        req.token = token

        next()
    } catch (error) {
        return res.status(401).json({ error: 'token missing or invalid' })
        next()
    }
}