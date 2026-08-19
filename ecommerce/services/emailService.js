import nodemailer from "nodemailer";

export async function sendVerificationEmail(
  email,
  otp,
  subject = "Verify your email account",
  text = `Your OTP: ${otp}`,
  html = `<b>Your OTP: ${otp}</b>`
) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject,
      text,
      html,
    });

    return info.accepted.length > 0;
  } catch (error) {
    console.error("Error sending verification email:", error);
    return false;
  }
}
