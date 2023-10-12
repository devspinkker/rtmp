const axios = require("axios");

let url = process.env.BACKEND_URL + "/user";

async function getUserByKey(key) {
    try {
        let response = await axios.get(`${url}/get_user_by_key?key=${key}`);
        return response.data.data;
    } catch (error) {
        return error
    }
}

async function updateOnline(id, online) {
    try {
        const res = await axios.post(`${url}/update_online/${id}`, { online })
        return res;
    } catch (error) {
        console.log('Error while calling updateOnline', error);
    }
}

module.exports = getUserByKey, updateOnline