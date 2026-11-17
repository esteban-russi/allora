#!/usr/bin/env bash
# One-time Google Cloud + GitHub setup for the Cloud Run deploy workflow.
# Usage: scripts/setup-gcp-deploy.sh <gcp-project-id> [region] [service-name]
# Safe to re-run: existing resources are left as they are.
set -euo pipefail

PROJECT_ID="${1:?usage: $0 <gcp-project-id> [region] [service-name]}"
REGION="${2:-europe-west1}"
SERVICE="${3:-parliamo-italiano}"
REPO="parliamo-italiano"
GITHUB_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
POOL="github"
PROVIDER="github-actions"
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${SERVICE}-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

export CLOUDSDK_CORE_PROJECT="$PROJECT_ID" # scoped to this run, gcloud config untouched
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# Runs the command, ignoring "already exists" so the script can be re-run
create() { "$@" 2>/dev/null || echo "  (exists) ${*:1:4}"; }

echo "Enabling APIs..."
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com aiplatform.googleapis.com \
  texttospeech.googleapis.com speech.googleapis.com

echo "Creating Artifact Registry repo..."
create gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION"

echo "Creating service accounts..."
create gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer"
create gcloud iam service-accounts create "${SERVICE}-runtime" \
  --display-name="${SERVICE} Cloud Run runtime"

echo "Granting roles..."
# Runtime: call Vertex AI (Gemini) and bill TTS/STT to this project
for role in roles/aiplatform.user roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None --quiet \
    --member="serviceAccount:${RUNTIME_SA}" --role="$role" >/dev/null
done
# Deployer: manage the Cloud Run service, push images, run as the runtime SA
gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None --quiet \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/run.admin >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser >/dev/null

echo "Setting up Workload Identity Federation for ${GITHUB_REPO}..."
create gcloud iam workload-identity-pools create "$POOL" --location=global \
  --display-name="GitHub Actions"
create gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

echo "Writing GitHub repo variables..."
gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set GCP_DEPLOY_REGION --body "$REGION"
gh variable set CLOUD_RUN_SERVICE --body "$SERVICE"
gh variable set ARTIFACT_REPO --body "$REPO"
gh variable set GCP_DEPLOY_SA --body "$DEPLOY_SA"
gh variable set GCP_RUNTIME_SA --body "$RUNTIME_SA"
gh variable set GCP_WIF_PROVIDER \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

echo "Done. Pushes to main will now deploy ${SERVICE} to Cloud Run in ${REGION}."
