# Some (very prelimary) notes about schema evolution

## Most common operations
Both [a study on the MediaWiki schema
evolution](http://yellowstone.cs.ucla.edu/schema-evolution/index.php/Schema_Evolution_Benchmark#Micro-Classi.EF.AC.81cation_of_Changes)
and [this paper](http://www.cs.ucr.edu/~neamtiu/pubs/hotswup11wu.pdf) identify
the following operations as by far the most common:

1. add a column (39% of MW schema changes, which are 55% of total)
2. drop a column (26% of MW schema changes)
3. modify an index (40% of overall MW changes)
4. add / remove a table (not really a schema change)

## Goal: balance between complexity & functionality
From the data above it is clear that a lot of utility can already be provided
by the ability to add or remove columns and indexes. Additionally, more
complex operations are often not or only partially supported by backend
systems (Cassandra for example only supports renaming primary key columns), so
would be much harder to support.

## API
MediaWiki has had good success using a sequential schema evolution mechanism,
in which an upgrade step (which can be just a SQL statement like `alter
table`, but also more complex code) is executed if associated tests match the
existing schema. This is a very powerful system, perhaps too powerful for a
distributed storage service. It might make more sense to focus on the minimal
functionality needed on the service side, and leave anything more complex to
users.

### API sketch
If we focus on addition / removal of columns and indexes, then it might be
feasible to directly diff the declarative JSON schema sent during table
creation to figure out the necessary changes. This is especially
straightforward for new non-primary-key columns and new indexes (okay,
building indexes is more work, but it's all safe).

Deletion is more problematic. For secondary indexes this might be okay as
those can be rebuilt, but column deletion could lose data. It is also common
that an app needs to migrate old data to a new format before removing the
column. Removal of columns can also affect existing indexes, which is more
complex. For these reasons it seems to make more sense to provide a different,
more explicit, mechanism to delete columns. Even if that functionality is
missing initially, additional information can be excluded using the proj
selector. In systems like Cassandra, the main practical downside of old
columns is the storage used for existing data in them. In new rows without
explicit values for these old columns, no space is used for these columns.

#### Possible implementation stages

0. Whenever a PUT is made to re-create an existing table, diff the schemas and
bail out if there is any difference.
1. Handle new non-primary-key columns by adding them to the table.
2. Ignore deleted non-primary-key columns, and provide explicit entry point to
delete non-primary-key columns from an app.
3. Add / build and remove secondary indexes.
