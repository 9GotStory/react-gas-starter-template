# Starter App Domain

Single-context domain glossary for a React + Google Apps Script application. Replace the starter `Item` sample entries below with your downstream project's domain terminology and Google Sheet mappings.

## Language

**Item** _(starter sample)_:
A sample catalog record stored in the `Items` Google Sheet, identified by a generated UUID (`id`) and a leading-zero-preserving string code (`code`).
_Avoid_: Row, entry, record

## Sheet-to-Entity Mapping

| Sheet Name                 | Entity Name | Key Columns                       | Notes                                                                          |
| -------------------------- | ----------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `Items` _(starter sample)_ | `Item`      | `id`, `code`, `name`, `createdAt` | All text columns formatted as `@` before write; replace in downstream projects |
