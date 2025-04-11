const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const routes = require("./src/routes/index");

const app = express();
const limit = "50mb";

const server = app.listen();
server.setTimeout(1000000);

const router = express.Router();
router.use(bodyParser.json());

const allowedOrigin = 'http://localhost:3000';

const corsOptions = {
    origin: allowedOrigin,
    credentials: true,
};

app.use(cors(corsOptions));

app.use(express.urlencoded({ limit, extended: true }));
app.use(express.json({ limit }));

app.use(bodyParser.urlencoded({ limit, extended: true }));
app.use(bodyParser.json({ limit }));

app.use(routes);

const port = process.env.PORT || 8080;

app.listen(port, () => {
    console.log(`Server port: ${port}`);
});

module.exports = app;