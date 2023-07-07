// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }
var grammar = {
    Lexer: undefined,
    ParserRules: [
    {"name": "DateTime$ebnf$1", "symbols": ["Date"], "postprocess": id},
    {"name": "DateTime$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "DateTime", "symbols": ["DateTime$ebnf$1", "_", "Time"], "postprocess": d => ({ date: d[0], time: d[2] })},
    {"name": "Date", "symbols": ["Value", "DComponent", "DComponent"], "postprocess": d => ({ year: d[0], month: d[1], day: d[2] })},
    {"name": "DComponent", "symbols": [{"literal":"/"}, "Value"], "postprocess": d => d[1]},
    {"name": "Time$ebnf$1", "symbols": ["TComponent"], "postprocess": id},
    {"name": "Time$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Time$ebnf$2$subexpression$1$subexpression$1", "symbols": [/[aA]/, /[mM]/], "postprocess": function(d) {return d.join(""); }},
    {"name": "Time$ebnf$2$subexpression$1", "symbols": ["Time$ebnf$2$subexpression$1$subexpression$1"], "postprocess": id},
    {"name": "Time$ebnf$2$subexpression$1$subexpression$2", "symbols": [/[pP]/, /[mM]/], "postprocess": function(d) {return d.join(""); }},
    {"name": "Time$ebnf$2$subexpression$1", "symbols": ["Time$ebnf$2$subexpression$1$subexpression$2"], "postprocess": id},
    {"name": "Time$ebnf$2", "symbols": ["Time$ebnf$2$subexpression$1"], "postprocess": id},
    {"name": "Time$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Time", "symbols": ["Value", "TComponent", "Time$ebnf$1", "_", "Time$ebnf$2"], "postprocess": d => ({ hour: d[0], minute: d[1], second: d[2], meridian: d[4] })},
    {"name": "TComponent", "symbols": [{"literal":":"}, "Value"], "postprocess": d => d[1]},
    {"name": "Value", "symbols": ["int"], "postprocess": id},
    {"name": "Value", "symbols": ["Star"], "postprocess": id},
    {"name": "Value", "symbols": [{"literal":"{"}, "_", "Pattern", "_", {"literal":"}"}], "postprocess": d => d[2]},
    {"name": "Pattern", "symbols": ["Star"], "postprocess": id},
    {"name": "Pattern", "symbols": ["Range"], "postprocess": id},
    {"name": "Pattern", "symbols": ["List"], "postprocess": id},
    {"name": "Pattern", "symbols": ["ModuloLeft", {"literal":"/"}, "int"], "postprocess": d => ({ type: "modulo", left: d[0], right: d[2] })},
    {"name": "ModuloLeft", "symbols": ["Range"], "postprocess": id},
    {"name": "ModuloLeft", "symbols": ["Star"], "postprocess": id},
    {"name": "Range", "symbols": ["int", {"literal":"-"}, "int"], "postprocess": d => ({ type: "range", left: d[0], right: d[2] })},
    {"name": "List$ebnf$1", "symbols": []},
    {"name": "List$ebnf$1", "symbols": ["List$ebnf$1", "ListItem"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "List", "symbols": ["int", "List$ebnf$1"], "postprocess": d => [d[0], ...d[1]]},
    {"name": "ListItem", "symbols": [{"literal":","}, "int"], "postprocess": d => d[1]},
    {"name": "Star", "symbols": [{"literal":"*"}], "postprocess": id},
    {"name": "int$ebnf$1", "symbols": [/[0-9]/]},
    {"name": "int$ebnf$1", "symbols": ["int$ebnf$1", /[0-9]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "int", "symbols": ["int$ebnf$1"], "postprocess": d => parseInt(d[0].join(""), 10)},
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1", /[\s]/], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "_", "symbols": ["_$ebnf$1"], "postprocess": d => null}
]
  , ParserStart: "DateTime"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
