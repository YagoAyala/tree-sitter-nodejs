const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    res.setHeader("WWW-Authenticate", "Basic")
    return res.status(401).send("Unauthorized")
  }

  const base64Credentials = authHeader.split(" ")[1]
  const credentials = Buffer.from(base64Credentials, "base64").toString("ascii")
  const [username, password] = credentials.split(":")

  if (username === "myUser" && password === "myPass") {
    next()
  } else {
    res.setHeader("WWW-Authenticate", "Basic")
    return res.status(401).send("Unauthorized")
  }
}

module.exports = basicAuth
