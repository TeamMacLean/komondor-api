module.exports.isAuthenticated = function (req, res, next) {
  if (req.user) {
    // console.log("have user");
    next();
  } else {
    // console.log("dont have user");
    next(new Error("user not found"));
  }
}
