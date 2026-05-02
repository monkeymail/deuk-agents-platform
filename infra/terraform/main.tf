# DEUK AWS Baseline — Terraform
# Bootstraps: S3 state bucket, DynamoDB lock table, OIDC provider for GitHub Actions.

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # After first bootstrap, uncomment and migrate state to S3:
  # backend "s3" {
  #   bucket         = "deuk-terraform-state-eu-west-1"
  #   key            = "platform/baseline.tfstate"
  #   region         = "eu-west-1"
  #   dynamodb_table = "deuk-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = "eu-west-1"

  default_tags {
    tags = {
      Project   = "deuk-agents"
      ManagedBy = "terraform"
    }
  }
}

# ─── S3 State Bucket ───
resource "aws_s3_bucket" "terraform_state" {
  bucket = "deuk-terraform-state-eu-west-1"
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── DynamoDB Lock Table ───
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "deuk-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# ─── GitHub Actions OIDC Provider ───
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = [
    "6938fd4e98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# ─── Outputs ───
output "s3_state_bucket" {
  value = aws_s3_bucket.terraform_state.id
}

output "dynamodb_lock_table" {
  value = aws_dynamodb_table.terraform_locks.id
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
