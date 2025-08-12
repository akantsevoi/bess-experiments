# Instruction for any coding agent
- Claude
- Gemini
- Codex
- Meatbags
- etc.

## Development Guidelines for LLM Agents

- **Objective:** Implement a revenue-loss visualizer/calculator.
- **Modularity:** The code should be broken down into smaller, reusable functions and modules.
- **Testability:** Write unit tests for the core logic.
- **Frameworks:** Use only vanilla JavaScript. No heavy frameworks like Ract.js, Angular, etc are allowed.
- **Structure:** Keep the application as a single HTML file (`index.html`) with embedded or linked JavaScript (`app.js`) and CSS.
- **File Descriptions:**
    - `index.html`: The main HTML file for the application.
    - `app.js`: Contains the JavaScript logic for the application.
    - `app.test.js`: Contains unit tests for `app.js`.
    - `styles.css`: Styles 
- **Quality**: make sure that test pass on each change by running `node app.test.js`
