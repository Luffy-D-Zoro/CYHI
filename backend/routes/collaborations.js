const { Router } = require("express");
const {
  createCollaboration,
  getCollaboration,
  sendInvitations,
} = require("../controllers/collaborationController");

const router = Router();

router.post("/", createCollaboration);
router.get("/:teamId", getCollaboration);
router.post("/:teamId/invitations/send", sendInvitations);

module.exports = router;
