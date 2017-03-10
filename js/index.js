"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require("events");
var _ = require("lodash");
var defaultOptions = {
    EnabledAtStart: false,
    MaxWorkersCap: null,
    MinWorkersCap: null,
    PollingIntervalMS: 1000,
    TerminateWorkerAfterMinutesIdle: 1
};
// the class supported the following events:
// 1. polling
// 2. scalable-state (IAutoScalableState)
// 3. error (error: any)
// 4. change
// 5. down-scaling (workers: IWorker[])
// 6. up-scaling (numInstances: number)
// 7. down-scaled (workerKeys: WorkerKey[])
// 8. up-scaled (workerKeys: WorkerKey[])
// 9. workers-terminated (workerKeys: WorkerKey[])
// 10. workers-launched (workerKeys: WorkerKey[])
var GridAutoScaler = (function (_super) {
    __extends(GridAutoScaler, _super);
    function GridAutoScaler(scalableGrid, implementation, options) {
        var _this = _super.call(this) || this;
        _this.scalableGrid = scalableGrid;
        _this.implementation = implementation;
        _this.options = null;
        _this.__terminatingWorkers = null;
        _this.__launchingWorkers = null;
        options = options || defaultOptions;
        _this.options = _.assignIn({}, defaultOptions, options);
        _this.__enabled = _this.options.EnabledAtStart;
        _this.__MaxWorkersCap = _this.options.MaxWorkersCap;
        _this.__MinWorkersCap = _this.options.MinWorkersCap;
        _this.TimerFunction.apply(_this);
        return _this;
    }
    Object.defineProperty(GridAutoScaler.prototype, "Scaling", {
        get: function () { return (this.__terminatingWorkers !== null || this.__launchingWorkers !== null); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "LaunchingWorkers", {
        get: function () {
            if (this.__launchingWorkers) {
                var workers = [];
                for (var workerKey in this.__launchingWorkers)
                    workers.push(workerKey);
                return workers;
            }
            else
                return [];
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "TerminatingWorkers", {
        get: function () {
            if (this.__terminatingWorkers) {
                var workers = [];
                for (var workerKey in this.__terminatingWorkers)
                    workers.push(workerKey);
                return workers;
            }
            else
                return [];
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "Enabled", {
        get: function () { return this.__enabled; },
        set: function (newValue) {
            if (newValue !== this.__enabled) {
                this.__enabled = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMaxWorkersCap", {
        get: function () { return (typeof this.__MaxWorkersCap === 'number' && this.__MaxWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MaxWorkersCap", {
        get: function () { return this.__MaxWorkersCap; },
        set: function (newValue) {
            if (newValue !== this.__MaxWorkersCap) {
                this.__MaxWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMinWorkersCap", {
        get: function () { return (typeof this.__MinWorkersCap === 'number' && this.__MinWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MinWorkersCap", {
        get: function () { return this.__MinWorkersCap; },
        set: function (newValue) {
            if (newValue !== this.__MinWorkersCap) {
                this.__MinWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.getWorkerFromState = function (state) {
        return {
            Id: state.Id,
            Name: state.Name,
            RemoteAddress: state.RemoteAddress,
            RemotePort: state.RemotePort
        };
    };
    // down-scaling logic
    GridAutoScaler.prototype.getDownScalingPromise = function (state) {
        if (state.QueueEmpty) {
            var toBeTerminatedWorkers = [];
            var maxTerminateCount = (this.HasMinWorkersCap ? Math.max(state.WorkerStates.length - this.MinWorkersCap, 0) : null);
            for (var i in state.WorkerStates) {
                var ws = state.WorkerStates[i];
                if (!ws.Busy && typeof ws.LastIdleTime === 'number') {
                    var elapseMS = state.CurrentTime - ws.LastIdleTime;
                    if (elapseMS > this.options.TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                        if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                            toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                    }
                }
            }
            if (toBeTerminatedWorkers.length > 0) {
                this.emit('down-scaling', toBeTerminatedWorkers);
                return this.implementation.TerminateInstances(toBeTerminatedWorkers);
            }
            else
                return Promise.resolve(null);
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.getUpScalingWithTaskDebtPromise = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.implementation.ComputeWorkersLaunchRequest(state) // compute the number of additional workers desired
                .then(function (launchRequest) {
                var numWorkersToLaunch = 0;
                if (_this.HasMaxWorkersCap) {
                    var workersAllowance = Math.max(_this.MaxWorkersCap - state.WorkerStates.length, 0); // number of workers stlll allowed to be launched under the cap
                    numWorkersToLaunch = Math.min(launchRequest.NumInstance, workersAllowance);
                }
                else
                    numWorkersToLaunch = launchRequest.NumInstance;
                if (numWorkersToLaunch > 0) {
                    _this.emit('up-scaling', numWorkersToLaunch);
                    _this.implementation.LaunchInstances({ NumInstance: numWorkersToLaunch, Hint: launchRequest.Hint })
                        .then(function (workerKeys) {
                        resolve(workerKeys);
                    }).catch(function (err) {
                        reject(err);
                    });
                }
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    // up-scaling logic
    GridAutoScaler.prototype.getUpScalingPromise = function (state) {
        if (!state.QueueEmpty) {
            if (state.CPUDebt > 0)
                return this.getUpScalingWithTaskDebtPromise(state);
            else
                return Promise.resolve(null);
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.feedLastestWorkerStates = function (workerStates) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var workers = [];
            for (var i in workerStates) {
                var ws = workerStates[i];
                workers.push(_this.getWorkerFromState(ws));
            }
            _this.implementation.TranslateToWorkerKeys(workers)
                .then(function (workerKeys) {
                var currentWorkers = {};
                for (var i in workerKeys) {
                    var workerKey = workerKeys[i];
                    currentWorkers[workerKey] = true;
                }
                var someWorkersGotTerminated = false;
                var someWorkersGotLaunched = false;
                if (_this.__terminatingWorkers) {
                    var workers_1 = _this.TerminatingWorkers;
                    var terminatedWorkers = [];
                    for (var i in workers_1) {
                        var workerKey = workers_1[i];
                        if (!currentWorkers[workerKey]) {
                            delete _this.__terminatingWorkers[workerKey];
                            terminatedWorkers.push(workerKey);
                        }
                    }
                    if (terminatedWorkers.length > 0) {
                        someWorkersGotTerminated = true;
                        _this.emit('workers-terminated', terminatedWorkers);
                    }
                    if (_.isEmpty(_this.__terminatingWorkers))
                        _this.__terminatingWorkers = null;
                }
                if (_this.__launchingWorkers) {
                    var workers_2 = _this.LaunchingWorkers;
                    var launchedWorkers = [];
                    for (var i in workers_2) {
                        var workerKey = workers_2[i];
                        if (currentWorkers[workerKey]) {
                            delete _this.__launchingWorkers[workerKey];
                            launchedWorkers.push(workerKey);
                        }
                    }
                    if (launchedWorkers.length > 0) {
                        someWorkersGotLaunched = true;
                        _this.emit('workers-launched', launchedWorkers);
                    }
                    if (_.isEmpty(_this.__launchingWorkers))
                        _this.__launchingWorkers = null;
                }
                if (someWorkersGotTerminated || someWorkersGotLaunched)
                    _this.emit('change');
                resolve({});
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    Object.defineProperty(GridAutoScaler.prototype, "AutoScalingPromise", {
        get: function () {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var state = null;
                _this.scalableGrid.getCurrentState() // get the current state of the scalable
                    .then(function (st) {
                    state = st;
                    _this.emit('scalable-state', state);
                    return _this.feedLastestWorkerStates(state.WorkerStates);
                }).then(function () {
                    if (_this.Enabled && !_this.Scaling)
                        return Promise.all([_this.getDownScalingPromise(state), _this.getUpScalingPromise(state)]);
                    else
                        return Promise.resolve([null, null]);
                }).then(function (value) {
                    var oldScaling = _this.Scaling;
                    var terminateWorkerKeys = value[0];
                    if (terminateWorkerKeys != null && terminateWorkerKeys.length > 0) {
                        _this.__terminatingWorkers = {};
                        for (var i in terminateWorkerKeys) {
                            var workerKey = terminateWorkerKeys[i];
                            _this.__terminatingWorkers[workerKey] = true;
                        }
                        _this.emit('down-scaled', terminateWorkerKeys);
                    }
                    var launchWorkerKeys = value[1];
                    if (launchWorkerKeys != null && launchWorkerKeys.length > 0) {
                        _this.__launchingWorkers = {};
                        for (var i in launchWorkerKeys) {
                            var workerKey = launchWorkerKeys[i];
                            _this.__launchingWorkers[workerKey] = true;
                        }
                        _this.emit('up-scaled', launchWorkerKeys);
                    }
                    if (_this.Scaling != oldScaling)
                        _this.emit('change');
                    var scalingTriggered = (terminateWorkerKeys !== null || launchWorkerKeys !== null);
                    resolve(scalingTriggered);
                }).catch(function (err) {
                    reject(err);
                });
            });
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "TimerFunction", {
        get: function () {
            var _this = this;
            var func = function () {
                _this.emit('polling');
                _this.AutoScalingPromise
                    .then(function (scalingTriggered) {
                    setTimeout(_this.TimerFunction, _this.options.PollingIntervalMS);
                }).catch(function (err) {
                    _this.emit('error', err);
                    setTimeout(_this.TimerFunction, _this.options.PollingIntervalMS);
                });
            };
            return func.bind(this);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "ImplementationConfigUrl", {
        get: function () { return this.implementation.getConfigUrl(); },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.toJSON = function () {
        return {
            Enabled: this.Enabled,
            Scaling: this.Scaling,
            HasMaxWorkersCap: this.HasMaxWorkersCap,
            MaxWorkersCap: this.MaxWorkersCap,
            HasMinWorkersCap: this.HasMinWorkersCap,
            MinWorkersCap: this.MinWorkersCap,
            LaunchingWorkers: this.LaunchingWorkers,
            TerminatingWorkers: this.TerminatingWorkers
        };
    };
    return GridAutoScaler;
}(events.EventEmitter));
exports.GridAutoScaler = GridAutoScaler;
