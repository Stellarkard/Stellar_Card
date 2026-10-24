const { execSync } = require('child_process');
const fs = require('fs');

const generalTopics = [
    { title: "Improve e2e testing pipeline stability", scope: "e2e" },
    { title: "Refactor tooling scripts to use modern Node features", scope: "tooling" },
    { title: "Setup automated dependabot security updates", scope: "security" },
    { title: "Implement comprehensive cross-browser testing", scope: "qa" },
    { title: "Add docker-compose for unified local development", scope: "devops" },
    { title: "Review and update project READMEs and contributor guides", scope: "docs" },
    { title: "Optimize Github Actions caching for faster builds", scope: "ci-cd" },
    { title: "Implement commitlint and Husky hooks", scope: "tooling" },
    { title: "Add automated accessibility (a11y) audits in CI", scope: "qa" },
    { title: "Consolidate ESLint and Prettier configurations", scope: "tooling" }
];

function generateIssue(id, topicIndex) {
    let topic = generalTopics[topicIndex % generalTopics.length];
    const title = `[general] ${topic.title} (Part ${Math.floor(topicIndex/10) + 1})`;
    
    const body = `### Description
Implement and refine the following task: **${topic.title}**.

### Requirements and context
- Code must follow project guidelines and existing design patterns.
- Ensure all edge cases are considered.
- Refer to the \`issueTemplate.md\` for quality standards.

### Suggested execution
1. Fork the repo and create a branch \`feature/${topic.scope}-task-${id}\`
2. Implement the necessary code changes.
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
    console.log("Starting to create 50 additional issues...");
    
    for (let i = 1; i <= 50; i++) {
        let topicIndex = i - 1;
        
        const { title, body } = generateIssue(i, topicIndex);
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
    console.log("Done creating additional issues!");
}

run();
