# three-jumpflood-demo

Demonstration showing application of the [Jump Flood Algorithm](https://en.wikipedia.org/wiki/Jump_flooding_algorithm) for realtime effects like model silhouette outline and glow. Based in part on the concepts described in [this article by Ben Golus](https://bgolus.medium.com/the-quest-for-very-wide-outlines-ba82ed442cd9).

## Potential Improvements

- Improved outline anti-aliasing referencing the above article.
- Limit the the jump flood operation range using stencil or scissor tests rather than operating on the full screen.
