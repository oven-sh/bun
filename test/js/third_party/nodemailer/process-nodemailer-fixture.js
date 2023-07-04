const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  host: "smtp.sendgrid.net",
  port: 587,
  secure: false,
  auth: {
    user: "apikey", // generated ethereal user
    pass: process.env.SMTP_SENDGRID_KEY, // generated ethereal password
  },
});

// send mail with defined transport object
let info = await transporter.sendMail({
  from: process.env.SMTP_SENDGRID_SENDER, // sender address
  to: process.env.SMTP_SENDGRID_SENDER, // list of receivers
  subject: "Hello ✔", // Subject line
  text: "Hello world?", // plain text body
  html: "<b>Hello world?</b>", // html body
});
console.log(typeof info?.messageId === "string");
