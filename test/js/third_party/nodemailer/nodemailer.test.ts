import { test, expect, describe } from "bun:test";
import nodemailer from "nodemailer";
describe("nodemailer", () => {
  // test hangs so we skip it until is investagated
  test.skip("basic smtp", async () => {
    const account = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      logger: true,
      debugger: true,
      auth: {
        user: account.user, // generated ethereal user
        pass: account.pass, // generated ethereal password
      },
    });

    // send mail with defined transport object
    let info = await transporter.sendMail({
      from: '"Fred Foo 👻" <foo@example.com>', // sender address
      to: "example@gmail.com", // list of receivers
      subject: "Hello ✔", // Subject line
      text: "Hello world?", // plain text body
      html: "<b>Hello world?</b>", // html body
    });
    const url = nodemailer.getTestMessageUrl(info);

    expect(url).toBeString();
    transporter.close();
  }, 10000);
});
