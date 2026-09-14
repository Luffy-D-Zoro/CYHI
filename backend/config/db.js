const mongoose = require("mongoose");
const dns = require("dns");

// Mitigates a common cause of "querySrv ETIMEOUT _mongodb._tcp...." on
// Atlas SRV connection strings: some networks/resolvers have trouble with
// IPv6-first DNS resolution. This does not fix a genuinely blocked/firewalled
// network — see the error message below for that case.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Node < 17 doesn't support this API; safe to ignore, connection just
  // won't get this particular mitigation.
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to your .env file.");
  }

  mongoose.connection.on("connected", () => {
    console.log("MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
  });

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000, // fail fast and clearly instead of hanging
    });
  } catch (err) {
    if (/querySrv|ETIMEOUT|ENOTFOUND/i.test(err.message)) {
      throw new Error(
        `MongoDB DNS/SRV lookup failed (${err.message}). This is almost always a network/DNS ` +
          "issue, not an application bug: check that this environment can reach the internet " +
          "and resolve DNS, that the cluster hostname in MONGODB_URI is correct, and that your " +
          "current IP is allow-listed in Atlas Network Access. If SRV lookups are blocked by a " +
          "firewall, use the non-SRV standard connection string (mongodb://host1,host2,.../...) " +
          "from Atlas's \"Connect\" dialog instead."
      );
    }
    throw err;
  }

  return mongoose.connection;
}

module.exports = connectDB;
