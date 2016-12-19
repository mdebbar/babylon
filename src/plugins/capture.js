import { TokenType, types as tt } from '../tokenizer/types';
import { TokContext, types as tc } from '../tokenizer/context';
import Parser from '../parser';

const CAPTURE_TYPE = 'Capture';

const BRACE_L = 123; // '{'
const BRACE_R = 125; // '}'

tc.captureContext = new TokContext('{{...}}', true);

tt.captureStart = new TokenType('{{', { beforeExpr: true, startsExpr: true });
tt.captureEnd = new TokenType('}}');

tt.captureStart.updateContext = function() {
  this.state.context.push(tc.captureContext);
  this.state.exprAllowed = true;
};

tt.captureEnd.updateContext = function() {
  this.state.context.pop();
  this.state.exprAllowed = false;
};

const pp = Parser.prototype;

pp.parseCaptureAt = function(startPos, startLoc) {
  const node = this.startNodeAt(startPos, startLoc);
  if (this.match(tt.name)) {
    node.name = this.state.value;
  // } else if (this.match(tt.star)) {
  //   node.name = '*'
  //   node.matchAny = true
  } else {
    this.unexpected(null, 'Unexpected token, expected Capture name');
  }
  this.next();
  this.expect(tt.captureEnd);
  return this.finishNode(node, CAPTURE_TYPE);
};

pp.parseSingleCapture = function() {
  const startPos = this.state.start, startLoc = this.state.startLoc;
  this.expect(tt.captureStart);
  if (this.match(tt.ellipsis)) {
    this.unexpected(null, 'Cannot use list Capture here');
  }
  return this.parseCaptureAt(startPos, startLoc);
};

pp.parseListCapture = function(end) {
  const startPos = this.state.start, startLoc = this.state.startLoc;
  this.expect(tt.captureStart);
  this.expect(tt.ellipsis);
  const node = this.parseCaptureAt(startPos, startLoc);
  if (end) {
    this.expect(end);
  }
  return node;
};

pp.isListCapture = function() {
  return this.match(tt.captureStart) && this.lookahead().type === tt.ellipsis;
};

function createMaybeParseSingleCapture(inner) {
  return function() {
    if (this.match(tt.captureStart)) {
      return this.parseSingleCapture();
    }
    return inner.apply(this, arguments);
  };
}

function createMaybeParseYield(inner) {
  return function() {
    if (this.match(tt._yield)) {
      return this.parseYield();
    }
    return inner.apply(this, arguments);
  };
}

export default function(instance) {
  // Add the handling of '{{' and '}}' tokens.
  instance.extend('getTokenFromCode', function(inner) {
    return function(code) {
      const context = this.curContext();
      const next = this.input.charCodeAt(this.state.pos + 1);

      if (code === BRACE_L && next === BRACE_L) {
        this.state.pos += 2;
        return this.finishToken(tt.captureStart);
      }
      if (context === tc.captureContext && code === BRACE_R && next === BRACE_R) {
        this.state.pos += 2;
        return this.finishToken(tt.captureEnd);
      }
      return inner.call(this, code);
    };
  });

  // Skip `checkLVal` for `Capture` nodes.
  instance.extend('checkLVal', function(inner) {
    return function(expr) {
      if (expr.type !== CAPTURE_TYPE) {
        return inner.apply(this, arguments);
      }
    };
  });

  // Skip `toAssignableList` for `Capture` nodes.
  instance.extend('toAssignableList', function(inner) {
    return function(params) {
      if (params && params.type === CAPTURE_TYPE) {
        return params;
      }
      return inner.apply(this, arguments);
    };
  });

  // Capture single things:

  instance.extend('parseIdentifier', createMaybeParseSingleCapture);
  instance.extend('parseFunctionId', createMaybeParseSingleCapture);
  instance.extend('parseBindingAtom', createMaybeParseSingleCapture);
  instance.extend('parseExprAtom', createMaybeParseSingleCapture);
  // instance.extend('parseStatement', createMaybeParseSingleCapture);

  instance.extend('parseMaybeAssign', createMaybeParseYield);

  // Capture lists of things:

  instance.extend('parseVar', function(inner) {
    return function(node, isFor, kind) {
      if (this.isListCapture()) {
        node.kind = kind.keyword;
        return node.declarations = this.parseListCapture();
      }
      return inner.apply(this, arguments);
    };
  });

  instance.extend('parseBlockBody', function(inner) {
    return function(node, allowDirectives, topLevel, end) {
      if (this.isListCapture()) {
        node.directives = [];
        return node.body = this.parseListCapture(end);
      }
      return inner.apply(this, arguments);
    };
  });

  instance.extend('parseBindingList', function(inner) {
    return function(end) {
      if (this.isListCapture()) {
        return this.parseListCapture(end);
      }
      return inner.apply(this, arguments);
    };
  });

  instance.extend('parseExprList', function(inner) {
    return function(close) {
      if (this.isListCapture()) {
        return this.parseListCapture(close);
      }
      return inner.apply(this, arguments);
    };
  });

  instance.extend('parseCallExpressionArguments', function(inner) {
    return function(close) {
      if (this.isListCapture()) {
        return this.parseListCapture(close);
      }
      return inner.apply(this, arguments);
    };
  });

  instance.extend('parseBetweenParenAndDistinguishExpression', function(inner) {
    return function() {
      if (this.isListCapture()) {
        return { exprList: this.parseListCapture() };
      }
      return inner.apply(this, arguments);
    };
  });
}
