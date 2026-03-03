const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.post('/submit', async (req, res) => {
    const response = await axios.post('http://<INSTANCE_A_IP>:80/process', req.body);
    res.send(response.data.message);
});
app.listen(3000, () => console.log('Frontend on 3000'));
