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
  const { from, recipients, cc, subject, message } = mailObj;

  // In development mode, just log the email instead of sending it
  if (NODE_ENV === "development") {
    console.log("\n========== EMAIL (DEV MODE - NOT SENT) ==========");
    console.log("From:", from);
    console.log("To:", recipients);
    if (cc) console.log("CC:", cc);
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
      cc: cc, // copy to
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

// Parse ENA_ADMIN_EMAILS if it's a JSON array string, otherwise use it directly
let parsedAdminEmails = ENA_ADMIN_EMAILS;
try {
  if (ENA_ADMIN_EMAILS && ENA_ADMIN_EMAILS.startsWith('[')) {
    parsedAdminEmails = JSON.parse(ENA_ADMIN_EMAILS).join(', ');
  }
} catch (e) {
  console.warn("Could not parse ENA_ADMIN_EMAILS as JSON array, using raw string");
}

const mailObjDefaults = {
  from: SMTP_FROM,
  recipients: parsedAdminEmails,
};

const sendEmail = async ({ subject, message, to, cc }) => {
  const result = await actualSending({
    ...mailObjDefaults,
    recipients: to || mailObjDefaults.recipients,
    cc,
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
 * @param {string} [data.ownerUsername] - Username of the run owner.
 */
const sendMd5VerificationEmail = async (data) => {
  const { runId, runName, filesVerified, mismatches, errors, duration, ownerUsername } = data;

  const status = mismatches > 0 ? "FAILED (MD5 Mismatches)" : "SUCCESS";
  const subject = `MD5 Verification ${status}: ${runName}`;

  const durationSec = (duration / 1000).toFixed(2);

  // Attempt to look up the user's email address
  const User = require('../../models/User');
  let userEmail = null;
  let userDisplayName = ownerUsername;
  
  if (ownerUsername) {
    try {
      const user = await User.findOne({ username: ownerUsername });
      if (user && user.email) {
        userEmail = user.email;
        userDisplayName = user.name || user.username;
      }
    } catch (e) {
      console.error("Could not look up user for email", e);
    }
  }

  let message = userDisplayName ? `Hi ${userDisplayName},\n\n` : '';
  
  if (mismatches > 0 || errors > 0) {
    message += `The MD5 checksum verification for your recent sequence run has finished and found issues.\n\n`;
  } else {
    message += `The MD5 checksum verification for your recent sequence run has finished successfully.\n\n`;
  }

  message += `Run Name: ${runName}\n`;
  message += `Status: ${status}\n`;
  message += `Files Verified: ${filesVerified}\n`;
  message += `MD5 Mismatches: ${mismatches}\n`;
  message += `Errors: ${errors}\n`;
  message += `Duration: ${durationSec}s\n\n`;

  if (mismatches > 0) {
    message += `WARNING: ${mismatches} file(s) have MD5 checksum mismatches.\n`;
  }

  if (errors > 0) {
    message += `WARNING: ${errors} file(s) encountered errors during verification.\n`;
  }

  message += `\nPlease view the affected files on sequences.tsl.ac.uk here:\n`;
  message += `https://sequences.tsl.ac.uk/run?id=${runId}\n\n`;

  message += `Currently, only administrators can update MD5 values once a run has been submitted.\n`;
  message += `Please email the webmaster (deeks@nbi.ac.uk) with the correct MD5 checksums so they can be updated.\n\n`;

  message += `This is an automated message from sequences.tsl.ac.uk.`;

  const to = userEmail ? userEmail : mailObjDefaults.recipients;
  const cc = userEmail ? mailObjDefaults.recipients : undefined;

  return sendEmail({ subject, message, to, cc });
};

module.exports = sendEmail;
module.exports.sendMd5VerificationEmail = sendMd5VerificationEmail;
