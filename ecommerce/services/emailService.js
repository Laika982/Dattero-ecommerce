import nodemailer from "nodemailer";

export async function sendVerificationEmail(
  email,
  otp,
  subject = "Verify your email account",
  text = `Dattero E-Commerce

Your verification OTP is: ${otp}

This OTP is valid for 5 minutes. Please do not share this OTP with anyone.

If you did not request this OTP, please ignore this email.

Thank you,
Dattero Team`,

html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <h2 style="color: #222;">Dattero E-Commerce</h2>

    <p>Hi,</p>

    <p>Thank you for choosing <strong>Dattero</strong>.</p>

    <p>Use the following OTP to verify your email address:</p>

    <h1 style="letter-spacing: 5px;">${otp}</h1>

    <p>This OTP is valid for <strong>5 minutes</strong>.</p>

    <p>
      For your security, please do not share this OTP with anyone.
    </p>

    <p>
      If you did not request this OTP, you can safely ignore this email.
    </p>

    <p>Thank you,<br><strong>Dattero Team</strong></p>
  </div>
`
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
