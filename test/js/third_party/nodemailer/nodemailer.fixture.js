const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  host: "smtp.mailgun.org",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_MAILGUN_USER,
    pass: process.env.SMTP_MAILGUN_PASS,
  },
});

// send mail with defined transport object
let info = await transporter.sendMail({
  from: process.env.SMTP_MAILGUN_TO_FROM, // sender address
  to: process.env.SMTP_MAILGUN_TO_FROM, // list of receivers
  subject: "Hello ✔", // Subject line
  text: "Hello world?", // plain text body
  html: "<b>Hello world?</b>", // html body
});
console.log(typeof info?.messageId === "string");
