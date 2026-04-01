const fs = require('fs');
const { MailtrapClient } = require('mailtrap');

const TOKEN = fs.readFileSync('/root/dev/apps/mailit/mailtrap-token.txt', 'utf8').trim();

const mailClient = new MailtrapClient({
  endpoint: 'https://send.api.mailtrap.io/',
  token: TOKEN,
});

const sender     = { email: 'mark@hahnca.com', name: 'Mark Hahn' };
const recipients = [{ email: 'mark@hahnca.com' }];

async function sendMail(subject, text) {
  try {
    await mailClient.send({
      from:     sender,
      to:       recipients,
      subject:  subject,
      text:     text || subject,
      category: 'bkupall',
    });
    console.log(`Email sent: ${subject}`);
  } catch (err) {
    console.error(`Email failed: ${err.message}`);
  }
}

module.exports = { sendMail };
