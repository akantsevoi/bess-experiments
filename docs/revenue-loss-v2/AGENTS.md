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
- **Test Files:** Sample input data for both manual UI testing and automated unit tests is provided in the `files/` directory. Use these files when writing tests or demonstrating the UI.
- **Quality**: while writing the code run and upate unit tests to keep the quality high
- **Data points**: use and update information in [Readme#Input data](./Readme.md#1-input-data) section that contains definition of

## Run tests
`node app.test.js`