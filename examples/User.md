# User
- **firstName** `String`  
- **lastName** `String`  
- **email** `String` ``required`` ``unique`` ``lowercase``  
User's own -guess what?- email
- **age** `Number` ``default: 0`` ``min: 0``  
How old is user
- **role** `String` ``required`` ``default: 'user'`` ``'admin|user'``  
User's role for ACL
- **foo** `Object`  
User's foo  
contains foo informations
  - **bar** `Integer` ``min: 0``  
  bar quantity
  - **hasQux** `Boolean`  
  whether there's a qux
- **name** `virtual`  
- **isAdmin** `method`  
- **search** `static`  


## Indexes
- `{ email: 1 }`, `{ unique: 1, background: true }`

