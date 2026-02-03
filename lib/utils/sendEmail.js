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

const sendEmail = async ({ subject, message }) => {
  const result = await actualSending({
    ...mailObjDefaults,
    subject,
    message,
  });
  console.log("Email send complete");
  return result;
};

/**
 * Sends an email notification about MD5 verification completion.
 * @param {object} data - Verification result data.
 * @param {string} data.runId - The ID of the run.
 * @param {string} data.runName - The name of the run.
 * @param {number} data.filesVerified - Number of files verified.
 * @param {number} data.mismatches - Number of MD5 mismatches found.
 * @param {number} data.errors - Number of errors encountered.
 * @param {number} data.duration - Duration in milliseconds.
 */
const sendMd5VerificationEmail = async (data) => {
  const { runId, runName, filesVerified, mismatches, errors, duration } = data;

  const status = mismatches > 0 ? "FAILED (MD5 Mismatches)" : "SUCCESS";
  const subject = `MD5 Verification ${status}: ${runName}`;

  const durationSec = (duration / 1000).toFixed(2);

  let message = `MD5 Verification Results for Run: ${runName}\n`;
  message += `Run ID: ${runId}\n\n`;
  message += `Status: ${status}\n`;
  message += `Files Verified: ${filesVerified}\n`;
  message += `MD5 Mismatches: ${mismatches}\n`;
  message += `Errors: ${errors}\n`;
  message += `Duration: ${durationSec}s\n\n`;

  if (mismatches > 0) {
    message += `WARNING: ${mismatches} file(s) have MD5 checksum mismatches.\n`;
    message += `Please investigate the affected files in the komondor-web interface.\n\n`;
  }

  if (errors > 0) {
    message += `WARNING: ${errors} file(s) encountered errors during verification.\n`;
    message += `Please check the server logs for details.\n\n`;
  }

  message += `This is an automated message from the komondor-api MD5 verification system.`;

  return sendEmail({ subject, message });
};

module.exports = sendEmail;
module.exports.sendMd5VerificationEmail = sendMd5VerificationEmail;
