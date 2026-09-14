const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = `
<!DOCTYPE html>
<html>
<body>
  <form id="contact-form">
    <div>
      <label for="name-input">Full Name</label>
      <input type="text" id="name-input" name="full_name" required placeholder="John Doe" />
    </div>
    <div>
      <label>
        Email Address
        <input type="email" name="user_email" required />
      </label>
    </div>
    <div>
      <textarea name="message" placeholder="Your message here"></textarea>
    </div>
    <select name="role_preference" id="role-select">
      <option value="frontend">Frontend</option>
      <option value="backend">Backend</option>
    </select>
    <input type="submit" value="Submit" />
  </form>
</body>
</html>
`;

const dom = new JSDOM(html);
const document = dom.window.document;
const Node = dom.window.Node;
const Element = dom.window.Element;
const window = dom.window;

// Polyfill minimal required DOM structures so content.js can run
global.document = document;
global.Node = Node;
global.Element = Element;
global.window = window;

// Read and eval content.js
const contentJsPath = 'c:/Users/prate/CYHI/extension/content.js';
const code = fs.readFileSync(contentJsPath, 'utf8');

// We evaluate the code in the current context
eval(code);

// Run the function
const fields = extractFormFields();

console.log(JSON.stringify(fields, null, 2));
