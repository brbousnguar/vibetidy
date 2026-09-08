# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

<!-- Fragments in changelog/unreleased/ are folded in here at release time. -->

## [0.1.0] - 2026-09-08

### Added
- `vibetidy readme` — scans a repository and generates or refreshes README.md
  from verified facts, with a diff preview before writing.
- `vibetidy issue-check` — warns when a feature-sized change carries no linked
  GitHub issue; installs as a pre-commit hook, offers to create the issue
  via `gh`, and writes a changelog fragment.
- Provider-agnostic LLM client for any OpenAI-compatible endpoint, with
  presets for OpenAI, OpenRouter, Anthropic, Groq, DeepSeek, Together, Ollama
  and LM Studio.
