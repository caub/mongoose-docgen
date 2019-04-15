# Mongoose Documentation Generation

Generates documentation in Markdown or HTML from Mongoose model files

Usage:
```sh
npx mongoose-docgen [filePath].js > [filePath].md
```

### Convert Markdown to Html

You can convert the generated Markdown files to HTML files using for example [markdown-it](http://npm.im/markdown-it) and any relevant CSS, for example:
```css
body {
	font-family: Arial;
	color: rgba(0, 0, 0, 0.87);
}
h1, h2 {
	border-bottom: 1px solid #ccc;
}
h1 > a {
	text-decoration: none;
	margin-right: 1rem;
}
code {
	padding: 2px 4px;
	font-size: 90%;
	color: #c7254e;
	background-color: #f9f2f4;
	border-radius: 4px;
}
pre {
	background-color: #f9f2f4;
	padding: 2px 4px;
	border-radius: 4px;
}
strong > code {
	font-size: 110%;
}
p {
	line-height: 1.2em;
	margin-block-start: .5em;
	margin-block-end: .5em;
}
li {
	margin-block-start: .5em;
	margin-block-end: .5em;
}
```
