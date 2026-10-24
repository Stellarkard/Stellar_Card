#!/bin/bash

# Ensure GitHub CLI is installed
if ! command -v gh &> /dev/null
then
    echo "GitHub CLI (gh) could not be found. Please install it first."
    exit 1
fi

# Ensure user is authenticated
if ! gh auth status &> /dev/null
then
    echo "Please run 'gh auth login' before executing this script."
    exit 1
fi

# Template file
TEMPLATE_FILE="issueTemplate.md"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "Template file $TEMPLATE_FILE not found."
    exit 1
fi

# Folders to generate issues for
FOLDERS=("backend" "contract" "frontend" "sdk")

echo "Starting issue creation on GitHub..."

for folder in "${FOLDERS[@]}"; do
    echo "Creating issues for folder: $folder"
    for i in {1..50}; do
        TITLE="[$folder] Issue #$i"
        
        # Adding a short delay to avoid hitting rate limits
        echo "Creating: $TITLE"
        gh issue create --title "$TITLE" --body-file "$TEMPLATE_FILE" --label "$folder"
        
        # Optional: wait 1-2 seconds between requests to prevent API rate limiting
        sleep 2
    done
done

echo "All 200 issues have been successfully created!"
