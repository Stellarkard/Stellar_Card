const { execSync } = require('child_process');
const fs = require('fs');

const backendTopics = [
    { title: "Implement comprehensive API tests", scope: "test" },
    { title: "Standardize error handling middleware", scope: "refactor" },
    { title: "Add rate limiting to public endpoints", scope: "security" },
    { title: "Implement Winston logging system", scope: "monitoring" },
    { title: "Add Swagger/OpenAPI documentation", scope: "docs" },
    { title: "Extract routing logic from app.js", scope: "refactor" },
    { title: "Implement request input validation using Joi/Zod", scope: "security" },
    { title: "Add unit tests for db.js queries", scope: "test" },
    { title: "Setup Sentry for error tracking", scope: "monitoring" },
    { title: "Document the payment-handler.js flow", scope: "docs" }
];

const contractTopics = [
    { title: "Write comprehensive unit tests for core contract logic", scope: "test" },
    { title: "Implement Role-Based Access Control (RBAC)", scope: "security" },
    { title: "Optimize contract storage size", scope: "optimization" },
    { title: "Add NatSpec documentation to all functions", scope: "docs" },
    { title: "Implement fail-safe mechanisms for token transfers", scope: "security" }
];

function generateIssue(folder, id, topicIndex) {
    let topic;
    if (folder === "backend") {
        topic = backendTopics[topicIndex % backendTopics.length];
    } else {
        topic = contractTopics[topicIndex % contractTopics.length];
    }

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
- PR must include: \`Closes #${id}\`
- Complexity Level: Medium (150 points)
`;

    return { title, body };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("Starting to edit 65 issues...");
    
    for (let i = 1; i <= 65; i++) {
        let folder = i <= 50 ? "backend" : "contract";
        let topicIndex = i <= 50 ? i - 1 : i - 51;
        
        const { title, body } = generateIssue(folder, i, topicIndex);
        
        fs.writeFileSync('temp_body.md', body);
        
        console.log(`Editing Issue #${i}: ${title}`);
        try {
            execSync(`gh issue edit ${i} --title "${title}" --body-file temp_body.md`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to edit issue #${i}`);
        }
        
        // Wait 2 seconds to avoid rate limiting
        await delay(2000);
    }
    
    if (fs.existsSync('temp_body.md')) {
        fs.unlinkSync('temp_body.md');
    }
    console.log("Done editing issues!");
}

run();
