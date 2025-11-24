"use strict";
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

const { ENA_ADMIN_EMAILS, SMTP_HOST, SMTP_PORT, SMTP_FROM, NODE_ENV } =
  process.env;

/**
 * actualSending
 * @param {Object} mailObj - Email meta data and body
 * @param {String} from - Email address of the sender
 * @param {Array} recipients - Array of recipients email address
 * @param {String} subject - Subject of the email
 * @param {String} message - message
 */
const actualSending = async (mailObj) => {
  const { from, recipients, subject, message } = mailObj;

  // In development mode, just log the email instead of sending it
  if (NODE_ENV === "development") {
    console.log("\n========== EMAIL (DEV MODE - NOT SENT) ==========");
    console.log("From:", from);
    console.log("To:", recipients);
    console.log("Subject:", subject);
    console.log("Message:", message);
    console.log("=================================================\n");
    return "Dev mode: Email logged to console";
  }

  try {
    // Create a transporter
    let transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // Add other SMTP options here if necessary (e.g., secure, auth)
      secure: false,
      tls: {
        rejectUnauthorized: false,
      },
    });

    // send mail with defined transport object
    let mailStatus = await transporter.sendMail({
      from: from, // sender address
      to: recipients, // list of recipients
      subject: subject, // Subject line
      text: message, // plain text
    });
    console.log(`Message sent: ${mailStatus.messageId}`);
    return `Message sent: ${mailStatus.messageId}`;
  } catch (error) {
    console.error(error);
    throw new Error(
      `Something went wrong in the sendmail method. Error: ${error.message}`,
    );
  }
};

const mailObjDefaults = {
  from: SMTP_FROM,
  recipients: ENA_ADMIN_EMAILS,
};

module.exports = async ({ subject, message }) => {
  actualSending({
    ...mailObjDefaults,
    subject,
    message,
  }).then((res) => {
    console.log("Complete");
  });
};
