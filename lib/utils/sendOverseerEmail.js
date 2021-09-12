const sendEmail = require('./sendEmail');

const getEmailInfoForProject = (data) => {
    const { doNotSendToEna, _id, owner, name } = data;
    const type = 'Project'; // TODO remove

    // If you want fancy email, use https://schadokar.dev/posts/how-to-send-email-in-nodejs-with-expressjs/
    const subject = "New " + type + " to sequences.tsl.ac.uk to review";
    const message = `Hi there!
        \n\nPlease review sequences.tsl.ac.uk as a new ${type} has been recorded!
        \n\nName: ${name}
        \nUser: ${owner}
        \nSend to ENA: ${!doNotSendToEna}
        \n\nView the ${type} at: sequences.tsl.ac.uk/${type}?id=${_id}
    `;

    return {subject, message};
}

const getEmailInfoForSample = (data) => {
    const { _id, project, name, } = data;
    const { owner } = project;
    const type = 'Sample'; // TODO remove

    const subject = "New " + type + " to sequences.tsl.ac.uk to review";
    const message = `Hi there!
        \n\nPlease review sequences.tsl.ac.uk as a new ${type} has been recorded!
        \n\nName: ${name}
        \nUser: ${owner}
        \n\nView the ${type} at: sequences.tsl.ac.uk/${type}?id=${_id}
    `;

    return {subject, message};
}

const getEmailInfoForRun = (data) => {
    const { _id, name, owner } = data;
    const type = 'Run'; // TODO remove
    
    const subject = "New " + type + " to sequences.tsl.ac.uk to review";
    const message = `Hi there!
        \n\nPlease review sequences.tsl.ac.uk as a new ${type} has been recorded!
        \n\nName: ${name}
        \nUser: ${owner}
        \n\nView the ${type} at: sequences.tsl.ac.uk/${type}?id=${_id}
    `;

    return {subject, message};
}

module.exports = function (arguments) {
    return new Promise((resolve, reject) => {

        const { type, data } = arguments;
        var emailInfo = {};
        if (type === 'Project'){
            emailInfo = getEmailInfoForProject(data)
        } else if (type === 'Sample'){
            emailInfo = getEmailInfoForSample(data)
        } else if (type === 'Run'){
            emailInfo = getEmailInfoForRun(data)
        } else {
            console.error('problem finding type');
        }

        sendEmail(emailInfo).then(() => {        
            resolve('done');
        })
    })
}