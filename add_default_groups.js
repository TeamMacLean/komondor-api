const mongoose = require('mongoose')
const Group = require('./models/Group');

function bioinformatics() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "bioinformatics" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "bioinformatics",
          ldapGroups: [
            "CN=TSL-Data-Bioinformatics,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=slproj_bioinformatics_modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: false,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

function jjones() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "jjones" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "jjones",
          ldapGroups: [
            "CN=TSL-Data-Jonathan-Jones,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=slproj_23_modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: true,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

function skamoun() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "skamoun" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "skamoun",
          ldapGroups: [
            "CN=TSL-Data-Sophien-Kamoun,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=slproj_SK_Modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=RG-Sophien-Kamoun,OU=RGs,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: true,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

function mmoscou() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "mmoscou" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "mmoscou",
          ldapGroups: [
            "CN=TSL-Data-Matthew-Moscou,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=slproj_MM_modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: true,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

function two_blades() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "two_blades" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "two_blades",
          ldapGroups: [
            "CN=TSL-Data-2Blades,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
            "CN=slproj_2BL1_modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: false,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

function ntalbot() {
  return new Promise((resolve, reject) => {
    Group.find({ name: "ntalbot" }).then((found) => {
      if (found && found.length) {
        resolve();
      } else {
        new Group({
          name: "ntalbot",
          ldapGroups: [
            "CN=slproj_NT_modify,OU=TSLGroups,OU=NBIGroups,DC=nbi,DC=ac,DC=uk",
          ],
          sendToEna: true,
        })
          .save()
          .then((saved) => {
            resolve();
          })
          .catch(reject);
      }
    });
  });
}

try {
    mongoose.connect('mongodb://localhost:27017/komondor', { useNewUrlParser: true });
} catch (err) {
  console.error(err);
}

const timeout = setInterval(() => {}, Number.MAX_VALUE);
Promise.all([
  bioinformatics(),
  jjones(),
  skamoun(),
  mmoscou(),
  two_blades(),
  ntalbot(),
])
  .then(() => {
    clearInterval(timeout);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    clearInterval(timeout);
    process.exit(0);
  });
