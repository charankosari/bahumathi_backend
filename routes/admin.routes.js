const router = require("express").Router();
const {
  createAgent,
  getAgents,
  updateAgent,
  deleteAgent,
  login,
  changePassword,
} = require("../controllers/admin.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

router.route("/login").post(login);

// All routes are protected
router.use(isAuthorized);

router.route("/change-password").put(changePassword);

// Routes requiring 'admin' role
router.use(roleAuthorize("admin"));

router.route("/agents").post(createAgent).get(getAgents);

router.route("/agents/:id").put(updateAgent).delete(deleteAgent);

module.exports = router;
