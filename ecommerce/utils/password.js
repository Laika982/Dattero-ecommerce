import bcrypt from "bcrypt";

export async function hashPassword(password) {
  try {
    const saltRounds = Number(process.env.SALT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error) {
    console.error("Error hashing password:", error);
    throw error;
  }
}

export async function verifyPassword(password, hashedPassword) {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    console.error("Error verifying password:", error);
    throw error;
  }
}

export { hashPassword as passwordHash };
