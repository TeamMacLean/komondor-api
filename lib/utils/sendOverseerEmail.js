const sendEmail = require("./sendEmail");

/**
 * Generates email notification info for a newly created entity.
 * @param {string} type - The entity type ('Project', 'Sample', or 'Run')
 * @param {object} data - The entity data
 * @returns {{ subject: string, message: string }}
 */
const getEmailInfo = (type, data) => {
  const { _id, name, owner, doNotSendToEna, project } = data;
  // For samples, owner comes from the parent project
  const entityOwner = owner || project?.owner;

  const subject = `New ${type} to sequences.tsl.ac.uk to review`;

  let message = `Hi there!
        \n\nPlease review sequences.tsl.ac.uk as a new ${type} has been recorded!
        \n\nName: ${name}
        \nUser: ${entityOwner}`;

  // Only include ENA info for projects
  if (type === "Project" && doNotSendToEna !== undefined) {
    message += `\n\nSend to ENA: ${!doNotSendToEna}`;
  }

  message += `\n\nView the ${type} at: sequences.tsl.ac.uk/${type.toLowerCase()}?id=${_id}
    `;

  return { subject, message };
};

module.exports = async function ({ type, data }) {
  const validTypes = ["Project", "Sample", "Run"];

  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid entity type: ${type}. Must be one of: ${validTypes.join(", ")}`,
    );
  }

  const emailInfo = getEmailInfo(type, data);
  await sendEmail(emailInfo);
  return "done";
};
