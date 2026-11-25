# The accounting export's format

`node bin/export-orders.js <folder>` prints one CSV row per order file in the folder, the header
first. The bookkeeper's import reads it every night, splits each row on commas (it doesn't
understand quotes) and reads amounts the way `formatMoney` writes them: a dollar sign, the dollars,
a point and two digits of cents, a minus sign in front of a negative amount (`$1234.50`, `-$3.70`).
There is no thousands separator.

## Columns

| Column | What it holds |
|---|---|
| `id` | The order's id, as the order file carries it |
| `date` | The order's date, `YYYY-MM-DD` |
| `subtotal` | The lines' amounts added up, before any discount |
| `discount` | What the order's code took off; `$0.00` without one |
| `shipping` | The shipping charged; `$0.00` for a pickup order or a free-shipping order |
| `tax` | Sales tax on the subtotal after the discount |
| `total` | `subtotal - discount + shipping + tax` |

## Example

```
id,date,subtotal,discount,shipping,tax,total
A-1041,2026-09-02,$60.00,$6.00,$0.00,$4.32,$58.32
A-1042,2026-09-02,$45.00,$0.00,$0.00,$3.60,$48.60
```

Every change to this format is listed in `CHANGELOG.md`, and the bookkeeper gets told before it
ships.
