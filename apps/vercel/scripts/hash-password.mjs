import { randomBytes, scrypt } from "node:crypto";

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal or provide ADMIN_PASSWORD.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish();
        reject(new Error("Cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        finish();
        resolve(value);
        return;
      }
      if (character === "\u0008" || character === "\u007f") {
        if (value) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (character >= " ") {
        value += character;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

const supplied = process.env.ADMIN_PASSWORD;
const password = supplied ?? (await readHidden("Admin password: "));
if (password.length < 12 || Buffer.byteLength(password, "utf8") > 1_024) {
  throw new Error("The admin password must contain between 12 and 1,024 bytes.");
}
if (!supplied) {
  const confirmation = await readHidden("Confirm password: ");
  if (confirmation !== password) throw new Error("The passwords do not match.");
}

const salt = randomBytes(16);
const derived = await derive(password, salt);
const encoded = [
  "scrypt",
  "v1",
  16_384,
  8,
  1,
  salt.toString("base64url"),
  derived.toString("base64url"),
].join("$");

console.log("Vercel environment-variable value:");
console.log(encoded);
console.log("\n.env.local line (escaped for dotenv expansion):");
console.log(`ADMIN_PASSWORD_HASH=${encoded.replaceAll("$", "\\$")}`);
