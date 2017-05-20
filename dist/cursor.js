"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
class Cursor {
  constructor(statement) {
    this.statement = statement;
    this.batchOffset = 0;
    this.batchStart = 0;
    this.batch = [];
    this.index = 0;
    this.columns = null;
    this.finished = false;
    this.needsMetadata = true;
  }

  each(callback) {
    this.next((err, _ref) => {
      let finished = _ref.finished,
          columns = _ref.columns,
          values = _ref.values,
          index = _ref.index,
          statement = _ref.statement;

      const next = () => {
        if (!finished) {
          this.each(callback);
        }
      };

      callback(err, { finished: finished, columns: columns, values: values, index: index, statement: statement, next: next });
    });
  }

  eachBatch(callback) {
    this.nextBatch(() => {
      const next = () => {
        this.index += this.batch.length;

        if (!this.finished) {
          this.eachBatch(callback);
        }
      };

      callback(this.error, { finished: this.finished,
        columns: this.columns,
        values: this.batch,
        index: this.index,
        statement: this.statement,
        next: next });
    });
  }

  next(callback) {
    const processResult = () => {
      let values = null;

      const batchOffset = this.batchOffset;

      if (this.batch.length) {
        const row = this.batch[this.batchOffset];

        this.batchOffset += 1;

        values = row ? row.values : null;
      }

      /* eslint-disable callback-return */
      callback(this.error, { finished: this.finished && this.batchOffset === this.batch.length,
        columns: this.columns,
        values: values,
        index: this.batchStart + batchOffset,
        statement: this.statement });
      /* eslint-enable callback-return */
    };

    if (this.batchOffset < this.batch.length) {
      if (this.batchOffset % 1000 === 0) {
        process.nextTick(processResult);
      } else {
        processResult();
      }
    } else {
      // we need to fetch the next batch into memory
      this.nextBatch(processResult);
    }
  }

  nextBatch(callback) {
    if (this.needsMetadata) {
      this.index = 0;
      this.columns = null;
    }

    this.statement.getResults(this.needsMetadata, results => {
      this.needsMetadata = false;
      this.batch = results;
      this.batchOffset = 0;
      this.finished = this.statement._native.finished();

      const hasResult = results && results.length;

      const hasColumns = hasResult && results[0] && results[0].columns;

      // results == [ null ]
      const emptyResultSet = hasResult && results[results.length - 1] == null;

      // results == [ ..., {} ]
      const endOfResultSet = hasResult && results[results.length - 1] && results[results.length - 1].values == null;

      if (hasColumns) {
        this.batchStart = 0;
        this.columns = results[0].columns;
      }

      // There are several possible states here because the client supports
      // multiple result sets in a single query and the complexity that batching adds.
      //
      // finished?               -> we are done, don't do anything
      // results === []          -> it's the signal of finished result set
      // results === [ null ]    -> a query that had no result set all (no column def, just a command like CREATE TABLE)
      // results === [ ..., {} ] -> the end of a result set has a {} at the end, note that this is NOT the end
      //                            of the entire cursor stream because there might be more SELECT queries in the command
      //                            text. If there are, this section below resets the index and the metadata flag so
      //                            that the next call to getResults will request the column metadata of the next query.
      //                            This is important when, for example, there are 2 completely different SELECT statements
      //                            in the command text. In that case we need to ask for metadata twice.
      if (!this.finished && (emptyResultSet || endOfResultSet)) {
        this.needsMetadata = true;
      }

      const error = this.statement._database.lastError;

      if (error) {
        this.error = error;
      }

      /* eslint-disable callback-return */
      callback();
      /* eslint-enable callback-return */

      if (results) {
        this.batchStart += results.length;
      }

      if (endOfResultSet) {
        this.batchStart = 0;
      }
    });
  }
}
exports.default = Cursor;
//# sourceMappingURL=cursor.js.map