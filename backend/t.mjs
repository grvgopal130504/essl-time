console.log("start");
process.on("uncaughtException", e => console.error("UNCAUGHT", e));
process.on("unhandledRejection", e => console.error("UNHANDLED", e));
await import("./src/server.js");
console.log("imported");
