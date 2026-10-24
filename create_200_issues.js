const { execSync } = require('child_process');
const fs = require('fs');

const backendTopics = [
    { title: "Implement rate limiting on order creation API", scope: "rate-limit" },
    { title: "Add logging for wallet transaction execution", scope: "logging" },
    { title: "Add Zod validation for card fulfillment endpoints", scope: "validation" },
    { title: "Setup unit tests for payment handler module", scope: "test" },
    { title: "Refactor error handling middleware in app.js", scope: "refactor" },
    { title: "Optimize database queries in db.js for listing orders", scope: "db-optimization" },
    { title: "Setup Sentry monitoring for jobs.js scheduler", scope: "monitoring" },
    { title: "Document API endpoints using Swagger/OpenAPI", scope: "docs" },
    { title: "Add secure headers middleware using Helmet", scope: "security" },
    { title: "Implement webhook retry logic with exponential backoff", scope: "webhook" }
];

const contractTopics = [
    { title: "Add unit tests for Soroban token transfer functionality", scope: "test" },
    { title: "Implement Role-Based Access Control (RBAC) in contract", scope: "rbac" },
    { title: "Optimize contract storage footprint to reduce gas", scope: "gas-optimization" },
    { title: "Add NatSpec documentation to contract functions", scope: "docs" },
    { title: "Implement reentrancy guard for payment callbacks", scope: "security" },
    { title: "Add event emission for contract state changes", scope: "events" },
    { title: "Validate input parameters in smart contract init", scope: "validation" },
    { title: "Setup automated integration testing for local Soroban network", scope: "test" },
    { title: "Add administrative withdraw limit protections", scope: "security" },
    { title: "Optimize contract WebAssembly binary size", scope: "wasm-optimization" }
];

const frontendTopics = [
    { title: "Build global loading, empty, and error state components", scope: "ui-states" },
    { title: "Implement responsive navigation layout for mobile and desktop", scope: "navigation" },
    { title: "Create first-run onboarding flow with state persistence", scope: "onboarding" },
    { title: "Add performance optimization pass for large transaction tables", scope: "performance" },
    { title: "Standardize UI theme variables (colors, typography, spacing)", scope: "theme" },
    { title: "Setup Storybook for reusable UI components", scope: "docs" },
    { title: "Implement mock wallet connection sandbox context", scope: "web3-mock" },
    { title: "Add unit tests for global state management hooks", scope: "test" },
    { title: "Improve keyboard accessibility and ARIA tags in modal windows", scope: "a11y" },
    { title: "Optimize bundle splitting and route-level lazy loading", scope: "performance" }
];

const sdkTopics = [
    { title: "Implement exponential backoff for SDK API request retries", scope: "network" },
    { title: "Add JSDoc documentation to all public SDK methods", scope: "docs" },
    { title: "Write unit tests for OWS wallet generation methods", scope: "test" },
    { title: "Add TypeScript typings for new order history events", scope: "types" },
    { title: "Add support for custom RPC endpoint config", scope: "network" },
    { title: "Optimize SDK dependency size for browser bundle compatibility", scope: "performance" },
    { title: "Create interactive basic purchase CLI tool in SDK examples", scope: "cli" },
    { title: "Implement client-side pagination wrapper for listing orders", scope: "pagination" },
    { title: "Setup Vitest integration suite for Soroban client", scope: "test" },
    { title: "Implement secure client-side encryption for key storage", scope: "security" }
];

function generateIssue(folder, id, topicIndex) {
    let topic;
    if (folder === "backend") topic = backendTopics[topicIndex % backendTopics.length];
    else if (folder === "contract") topic = contractTopics[topicIndex % contractTopics.length];
    else if (folder === "frontend") topic = frontendTopics[topicIndex % frontendTopics.length];
    else topic = sdkTopics[topicIndex % sdkTopics.length];

    const part = Math.floor(topicIndex / 10) + 1;
    const title = `[${folder}] ${topic.title} (Part ${part})`;
    
    const body = `### Description
Implement and refine the following task: **${topic.title}** within the \`stellar_card-${folder}\` directory.

This issue focuses on part ${part} of the implementation roadmap, dealing specifically with core configuration, testing hooks, or final integration steps.

### Requirements and context
- Follow existing patterns in the \`stellar_card-${folder}\` directory.
- Code should be clean, modular, and well-commented.
- Ensure all logic is fully tested and potential edge cases are handled.
- Refer to the project \`issueTemplate.md\` guidelines for point complexity expectations.

### Suggested execution
1. Fork the repository and create a branch named \`feature/${folder}/${topic.scope}-part-${part}\`
2. Review the existing codebase inside \`stellar_card-${folder}/\` to understand context.
3. Write clean, idiomatic code to implement this feature.
4. Add relevant unit or integration tests verifying the behavior.
5. Create a Pull Request containing a detailed description of the changes.

### Guidelines
- Request assignment before starting work on the issue.
- PR must close the issue by referencing: \`Closes #[issue_id]\`
- Complexity Level: Medium (150 points)
`;

    return { title, body };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("Starting to create 200 issues (50 per folder)...");
    const folders = ["backend", "contract", "frontend", "sdk"];
    
    for (const folder of folders) {
        console.log(`Processing folder: ${folder}`);
        for (let i = 1; i <= 50; i++) {
            const topicIndex = i - 1;
            const { title, body } = generateIssue(folder, i, topicIndex);
            
            fs.writeFileSync('temp_body.md', body);
            
            console.log(`[${folder}] Creating issue ${i}/50: "${title}"`);
            try {
                execSync(`gh issue create --title "${title}" --body-file temp_body.md`, { stdio: 'inherit' });
            } catch (e) {
                console.error(`Failed to create issue: "${title}". Error: ${e.message}`);
            }
            
            // Wait 2 seconds between creations to prevent API rate limiting
            await delay(2000);
        }
    }
    
    if (fs.existsSync('temp_body.md')) {
        fs.unlinkSync('temp_body.md');
    }
    console.log("Completed creating all 200 issues!");
}

run();
