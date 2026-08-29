const { execSync } = require('child_process');
const fs = require('fs');

const contractTopics = [
    { title: "Write comprehensive unit tests for core contract logic", scope: "test" },
    { title: "Implement Role-Based Access Control (RBAC)", scope: "security" },
    { title: "Optimize contract storage size", scope: "optimization" },
    { title: "Add NatSpec documentation to all functions", scope: "docs" },
    { title: "Implement fail-safe mechanisms for token transfers", scope: "security" },
    { title: "Review reentrancy vulnerabilities", scope: "security" },
    { title: "Setup deployment scripts for testnet", scope: "ci-cd" }
];

const frontendTopics = [
    { title: "Implement global loading, empty, and error state system", scope: "ux" },
    { title: "Build responsive navigation variants", scope: "ui" },
    { title: "Build onboarding flow for first-time users", scope: "ux" },
    { title: "Implement frontend performance optimization pass", scope: "performance" },
    { title: "Add unit tests for shared UI components", scope: "test" },
    { title: "Standardize theme colors and typography", scope: "ui" },
    { title: "Implement wallet connection states", scope: "web3" },
    { title: "Add accessibility (a11y) improvements", scope: "a11y" },
    { title: "Setup Storybook for component documentation", scope: "docs" },
    { title: "Optimize bundle size and code splitting", scope: "performance" }
];

const sdkTopics = [
    { title: "Write comprehensive unit tests for SDK methods", scope: "test" },
    { title: "Add TypeScript typings and interfaces", scope: "types" },
    { title: "Implement exponential backoff for API retries", scope: "network" },
    { title: "Add JSDoc comments to all public methods", scope: "docs" },
    { title: "Implement proper error wrapping and handling", scope: "error-handling" },
    { title: "Create examples directory with usage scripts", scope: "docs" },
    { title: "Setup automated CI/CD for NPM publishing", scope: "ci-cd" },
    { title: "Implement pagination utilities", scope: "utils" },
    { title: "Add support for custom RPC endpoints", scope: "network" },
    { title: "Optimize dependency size for browser usage", scope: "performance" }
];

function generateIssue(folder, id, topicIndex) {
    let topic;
    if (folder === "contract") topic = contractTopics[topicIndex % contractTopics.length];
    else if (folder === "frontend") topic = frontendTopics[topicIndex % frontendTopics.length];
    else topic = sdkTopics[topicIndex % sdkTopics.length];

    const title = `[${folder}] ${topic.title} (Part ${Math.floor(topicIndex/10) + 1})`;
    
    const body = `### Description
Implement and refine the following task: **${topic.title}** within the \`${folder}\` environment.

### Requirements and context
- Code must follow project guidelines and existing design patterns.
- Ensure all edge cases are considered.
- Refer to the \`issueTemplate.md\` for quality standards.

### Suggested execution
1. Fork the repo and create a branch \`feature/${topic.scope}-task-${id}\`
2. Implement the necessary code changes in the \`${folder}\` directory.
3. Write associated tests to prove your solution works.
4. Document any new functions or architecture changes.

### Guidelines
- Assignment required before starting.
- Complexity Level: Medium (150 points)
`;

    return { title, body };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("Starting to create remaining 135 issues...");
    
    // Contract remaining: 16 to 50
    for (let i = 16; i <= 50; i++) {
        let folder = "contract";
        let topicIndex = i - 16;
        
        const { title, body } = generateIssue(folder, i, topicIndex);
        fs.writeFileSync('temp_body.md', body);
        
        console.log(`Creating: ${title}`);
        try {
            execSync(`gh issue create --title "${title}" --body-file temp_body.md`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to create issue: ${title}`);
        }
        await delay(2000);
    }

    // Frontend: 1 to 50
    for (let i = 1; i <= 50; i++) {
        let folder = "frontend";
        let topicIndex = i - 1;
        
        const { title, body } = generateIssue(folder, i, topicIndex);
        fs.writeFileSync('temp_body.md', body);
        
        console.log(`Creating: ${title}`);
        try {
            execSync(`gh issue create --title "${title}" --body-file temp_body.md`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to create issue: ${title}`);
        }
        await delay(2000);
    }

    // SDK: 1 to 50
    for (let i = 1; i <= 50; i++) {
        let folder = "sdk";
        let topicIndex = i - 1;
        
        const { title, body } = generateIssue(folder, i, topicIndex);
        fs.writeFileSync('temp_body.md', body);
        
        console.log(`Creating: ${title}`);
        try {
            execSync(`gh issue create --title "${title}" --body-file temp_body.md`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to create issue: ${title}`);
        }
        await delay(2000);
    }
    
    if (fs.existsSync('temp_body.md')) {
        fs.unlinkSync('temp_body.md');
    }
    console.log("Done creating remaining issues!");
}

run();
