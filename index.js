const babel = require('@babel/parser');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Custom parser that reads all the type information in Mongoose schemas + the leading comment blocks
// and generates Docs in markdown, but it's easy to change to another format

const filePath = process.argv.slice(2).filter(x => !x.startsWith('-') || x === '-').slice(-1)[0];
if (!fs.existsSync(filePath)) {
	console.error(`Usage: npx mongoose-docgen [filePath]`)
	process.exit(1);
}

// mongoose special fields, except type
const MONGOOSE_FIELDS = ['ref', 'required', 'unique', 'select', 'default', 'enum', 'lowercase', 'trim', 'min', 'max', 'validate'];

// fix @babel/parser trailingComments for ObjectExpression or ArrayExpression https://github.com/babel/babel/issues/6683#issuecomment-459955614
function fixBabelComments(node) {
	const children = node.properties || node.elements;
	if (children) {
		for (let i = 0; i < children.length - 1; i++) {
			const n = children[i], next = children[i + 1];
			const cs = (next.leadingComments || []).filter(c => c.type === 'CommentLine' && c.loc.start.line === n.loc.start.line);
			if (cs.length) {
				n.trailingComments = [...n.trailingComments || [], ...cs];
				next.leadingComments = next.leadingComments.filter(c => cs.includes(c));
			}
			fixBabelComments(n.value || n);
		}
		if (children[children.length - 1]) fixBabelComments(children[children.length - 1].value || children[children.length - 1]);
	}
}

const upper = s => s[0].toUpperCase() + s.slice(1);

const formatSchemaName = s => upper(s.replace(/(?<!^)Schema$/, '')) // format a schema declaration name

const getDescription = str => str.split('\n').map(l => l.replace(/^(?:\s*\*)?\s*/, '').replace(/\s+$/, '')).filter(Boolean).join('  \n');

const renderOpts = opts => opts.map(([k, v]) => {
	if (v === 'true' || v === true) return k;
	if (k === 'enum') return `'${v.join('|')}'`;
	if (k === 'validate') return; // don't render this one for now, it's a function
	return `${k}: ${util.inspect(v, { breakLength: Infinity })}`
}).filter(Boolean).map(x => `\`\`${x}\`\``).join(' ');

class DocGen {
	constructor(source) {
		this.source = source;
		const { program: { body } } = babel.parse(source, { sourceType: 'script' });
		this.body = body;
	}

	// find a value in the body variable declarations
	findBodyValue(name) {
		const n = this.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === name);
		if (n) return this.resolveValue(n.declarations[0].init);
		const nDestructured = this.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.properties && n.declarations[0].id.properties.some(p => p.key.name === name));
		if (nDestructured) {
			const resolved = this.resolveValue(nDestructured.declarations[0].init);
			if (resolved) return resolved[name];
		}
	}

	resolveValue(node) {
		if (node.type === 'Identifier') {
			if (global[node.name]) return node.name;
			return this.findBodyValue(node.name);
		}
		if (node.type === 'ObjectExpression') {
			return node.properties.reduce((o, n) => {
				return n.type === 'SpreadElement' ?
					{ ...o, ...this.resolveValue(n.argument.name) } :
					{ ...o, [n.key.name]: this.resolveValue(n.value) };
			}, {});
		}
		if (node.type === 'CallExpression') {
			if (node.callee.name === 'require') {
				return require(path.join(path.dirname(filePath), node.arguments[0].value));
			}
			let fn;
			if (node.callee.name) {
				fn = global[node.callee.name] || this.findBodyValue(node.callee.name);
			} else {
				const target = global[node.callee.object.name] || this.findBodyValue(node.callee.object.name);
				fn = target[node.callee.property.name];
			}
			return fn(...node.arguments.map(node => this.resolveValue(node)));
		}
		if (node.type === 'MemberExpression') {
			const obj = this.resolveValue(node.object);
			return obj && obj[node.property.name] || node.property.name; // else just return the right-most member name
		}
		if (node.type === 'ArrayExpression') {
			return node.elements.map(elt => this.resolveValue(elt));
		}
		if (node.type === 'RegExpLiteral') {
			return new RegExp(node.pattern, node.flags);
		}
		if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
			return eval(this.source.slice(node.start, node.end)); // sighs
		}

		// for literals, just return value
		return node.value;
	}

	/**
	 * 
	 * @param {object} OjectProperty node 
	 * @param {*} indent 
	 */
	renderSchemaNode({ key, value, leadingComments, trailingComments }, indent = 0) {
		let arrayN = value.type === 'ArrayExpression' ? (value.elements[0].type === 'ArrayExpression' ? 2 : 1) : 0;
		const node = arrayN === 2 ? value.elements[0].elements[0] : arrayN === 1 ? value.elements[0] : value;
		let type = node.name || 'Object';
		let opts = []; // other schema options, like required, unique, ..., Array<[key, value]>
		let childrenNodes = []; // if a node has children nodes inline (inline sub-document)

		// todo resolveValue of node here

		if (node.type.endsWith('Literal')) type = node.value;
		else if (node.type === 'Identifier') type = formatSchemaName(node.name);
		else if (node.type === 'ObjectExpression') {
			const { type: typeNode, ...props } = node.properties.reduce((o, n) => {

				if (n.type === 'SpreadElement') {
					const nResolved = this.resolveValue(n.argument);
					// we need an object {key: Node}, so let's fake it and wrap values in simple nodes, except for type key
					for (const [key, value] of Object.entries(nResolved).filter(([k]) => k !== 'type')) {
						nResolved[key] = { value };
					}
					return { ...o, ...nResolved };
				}
				return { ...o, [n.key.name]: n.value };
			}, {});
			if (!typeNode || typeNode.type === 'ObjectExpression') { // nested inline node
				childrenNodes = !typeNode || Object.keys(props).some(k => !MONGOOSE_FIELDS.includes(k)) ? node.properties : typeNode.properties;
			}
			else if (typeNode.type === 'ArrayExpression' && typeNode.elements[0].type === 'ObjectExpression') { // nested inline node
				childrenNodes = typeNode.elements[0].properties;
				arrayN++;
			}
			else {
				const n = typeNode.type === 'ArrayExpression' ? typeNode.elements[0] : typeNode;
				if (n.type === 'MemberExpression') type = n.property.name;
				else /*(n.type === 'Identifier')*/ type = formatSchemaName(n.name);
			}
			opts = MONGOOSE_FIELDS.filter(k => props[k]).map(k => [k, this.resolveValue(props[k])]).filter(([, v]) => v !== undefined);
		}
		const comments = [
			...leadingComments ? leadingComments.map(c => c.value) : [],
			...node.type === 'ObjectExpression' ? (node.properties[0] && node.properties[0].leadingComments || []).filter(c => c.type === 'CommentLine' && c.loc.start.line === node.loc.start.line).map(c => c.value) : [],
			...trailingComments ? trailingComments.filter(c => c.type === 'CommentLine').map(c => c.value) : [],
		].filter(Boolean).join('\n');
		const description = getDescription(comments).replace(/^/gm, '  '.repeat(indent)).trimEnd();

		return `${'  '.repeat(indent)}- **${key.name}** \`${'['.repeat(arrayN)}${type}${']'.repeat(arrayN)}\`${opts.length ? ` ${renderOpts(opts)}` : ''}  ${description ? '\n' + description : ''}${childrenNodes.length ? '\n' + childrenNodes.map(n => this.renderSchemaNode(n, indent + 1)).join('\n') : ''}`;
	}

	renderSchema(schemaNode) {
		fixBabelComments(schemaNode.declarations[0].init.arguments[0]);
		const id = schemaNode.declarations[0].id.name;
		const virtualNodes = this.body.filter(n => n.type === 'ExpressionStatement' && n.expression.callee && n.expression.callee.object.callee && n.expression.callee.object.callee.object.name === id && n.expression.callee.object.callee.property.name === 'virtual');
		const virtuals = virtualNodes.map(({ expression: { callee: { object: { arguments: [{ value }] } } }, leadingComments }) => {
			const description = leadingComments ? getDescription(leadingComments[leadingComments.length - 1].value) : '';
			return `- **${value}** \`virtual\`  ${description ? '\n' + description : ''}`;
		}).filter(Boolean).join('\n');

		const methods = this.body.filter(({ type, expression: { left: { object: { object = {}, property = {} } = {} } = {} } = {} }) => type === 'ExpressionStatement' && object.name === id && property.name === 'methods')
			.map(({ expression: { left: { property: { name } = {} } = {} } = {}, leadingComments }) => {
				const description = leadingComments ? getDescription(leadingComments[leadingComments.length - 1].value) : '';
				return `- **${name}** \`method\`  ${description ? '\n' + description : ''}`;
			}).filter(Boolean).join('\n');

		const statics = this.body.filter(({ type, expression: { left: { object: { object = {}, property = {} } = {} } = {} } = {} }) => type === 'ExpressionStatement' && object.name === id && property.name === 'statics')
			.map(({ expression: { left: { property: { name } = {} } = {} } = {}, leadingComments }) => {
				const description = leadingComments ? getDescription(leadingComments[leadingComments.length - 1].value) : '';
				return `- **${name}** \`static\`  ${description ? '\n' + description : ''}`;
			}).filter(Boolean).join('\n');

		return `${schemaNode.declarations[0].init.arguments[0].properties.map(n => this.renderSchemaNode(n)).join('\n')}${virtuals ? '\n' + virtuals : ''}${methods ? '\n' + methods : ''}${statics ? '\n' + statics : ''}`;
	}

	render() {
		const schemaNodes = this.body.filter(({ type, declarations: [{ type: t, init: { callee = {} } = {} } = {}] = [] }) => type === 'VariableDeclaration' && t === 'VariableDeclarator' && (callee.name === 'Schema' || callee.object && callee.object.name === 'mongoose' && callee.property && callee.property.name === 'Schema'));

		const mainSchema = schemaNodes[schemaNodes.length - 1];
		const subSchemas = schemaNodes.slice(0, -1);

		const indexNodes = this.body.filter(n => n.type === 'ExpressionStatement' && n.expression.callee && n.expression.callee.property.name === 'index');

		const indexes = indexNodes.map(n => {
			return '- ' + n.expression.arguments.map(node => `\`${this.source.slice(node.start, node.end)}\``).join(', ');
		}).join('\n');

		return `# ${formatSchemaName(mainSchema.declarations[0].id.name)}
${this.renderSchema(mainSchema)}
${subSchemas.map(schema => `**\`${formatSchemaName(schema.declarations[0].id.name)}\`** is a sub-document with fields:
${this.renderSchema(schema)}`).join('\n\n')}

${indexes ? `## Indexes
${indexes}` : ''}
`;
	}
}

module.exports = DocGen;

if (!module.parent) {
	const docGen = new DocGen(fs.readFileSync(filePath === '-' ? 0 : filePath, 'utf-8')); // if we pass '-' arg, read the source from stdin, else read from filepath
	console.log(docGen.render());
}
