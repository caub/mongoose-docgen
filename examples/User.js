const { Schema } = require('mongoose');

const helpers = {
	not42: opts => ({
		...opts,
		type: Number,
		validate: v => v !== 42
	})
};

// User's infos
const UserSchema = new Schema({
	firstName: String,
	lastName: String,

	// User's own -guess what?- email
	email: {
		type: String,
		unique: true,
		lowercase: true,
		required: true
	},

	// How old is user
	age: { ...helpers.not42({ min: 0 }), default: 0 },

	// User's role for ACL
	role: {
		type: String,
		default: 'user',
		enum: ['admin', 'user'],
		required: true
	},

	/**
	 * User's foo
	 * contains foo informations
	 */
	foo: {
		bar: { // bar quantity
			type: Integer,
			min: 0
		},
		// whether there's a qux
		hasQux: Boolean
	}
});

UserSchema.virtual('name').get(function () {
	return this.firstName + ' ' + this.lastName;
});

UserSchema.methods.isAdmin = function () {
	return this.role === 'admin';
};

UserSchema.statics.search = function (name) {
	return this.find({
		$or: [
			{ name: { $regex: name, $options: 'i' } },
			{ email: { $regex: name, $options: 'i' } }
		]
	});
};

UserSchema.index({ email: 1 }, { unique: 1, background: true });

module.exports = mongoose.model('User', UserSchema);
