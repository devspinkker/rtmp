const axios = require("axios");

let url = process.env.BACKEND_URL + "/user";
let url2 = process.env.BACKEND_URL;
async function getUserByKey(key) {
    try {
        let response = await axios.get(`${url}/get_user_by_key?key=${key}`);
        return response.data.data;
    } catch (error) {
        return error
    }
}
async function GetUserBanInstream(key) {
    try {
        let response = await axios.get(`${url}/GetUserBanInstream?key=${key}`);
        return response.data.data;
    } catch (error) {
        return error
    }
}
async function AverageViewers(StreamerID) {
    try {
        const response = await axios.post(`${url2}/StreamSummary/AverageViewers`, { StreamerID: StreamerID })
        return response.data.data;
    } catch (error) {
        return error
    }
}
async function getUserByCmt(Cmt) {
    try {
        let response = await axios.get(`${url}/get_user_cmt?Cmt=${Cmt}`);
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

module.exports = { getUserByKey, updateOnline, getUserByCmt, AverageViewers, GetUserBanInstream }