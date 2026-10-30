import jwt from "jsonwebtoken";

export function generateToken(payload, expiresIn = "1d") {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is missing.");
  }
  return jwt.sign(payload, secret, { expiresIn });
}
