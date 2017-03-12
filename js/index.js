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
// 6. up-scaling (IWorkersLaunchRequest)
// 7. up-scaled (workerKeys: WorkerKey[])
// 8. down-scaled (workerKeys: WorkerKey[])
// 9. workers-launched (workerKeys: WorkerKey[])
var GridAutoScaler = (function (_super) {
    __extends(GridAutoScaler, _super);
    function GridAutoScaler(scalableGrid, implementation, options) {
        var _this = _super.call(this) || this;
        _this.scalableGrid = scalableGrid;
        _this.implementation = implementation;
        _this.options = null;
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
        get: function () { return (this.__launchingWorkers !== null); },
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
    GridAutoScaler.prototype.getUpScalePromise = function (launchRequest) {
        if (launchRequest && typeof launchRequest.NumInstances === "number" && launchRequest.NumInstances > 0) {
            this.emit('up-scaling', launchRequest);
            return this.implementation.LaunchInstances(launchRequest);
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.getDownScalePromise = function (toBeTerminatedWorkers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (toBeTerminatedWorkers && toBeTerminatedWorkers.length > 0) {
                var workerIds = [];
                for (var i in toBeTerminatedWorkers)
                    workerIds.push(toBeTerminatedWorkers[i].Id);
                _this.scalableGrid.disableWorkers(workerIds)
                    .then(function () {
                    _this.emit('down-scaling', toBeTerminatedWorkers);
                    return _this.implementation.TerminateInstances(toBeTerminatedWorkers);
                }).then(function (workerKeys) {
                    resolve(workerKeys);
                }).catch(function (err) {
                    reject(err);
                });
            }
            else
                resolve(null);
        });
    };
    GridAutoScaler.prototype.onUpScalingComplete = function (workersKeys) {
        var triggered = false;
        if (workersKeys != null && workersKeys.length > 0) {
            if (!this.__launchingWorkers)
                this.__launchingWorkers = {};
            for (var i in workersKeys) {
                var workerKey = workersKeys[i];
                this.__launchingWorkers[workerKey] = true;
            }
            this.emit('up-scaled', workersKeys);
            this.emit('change');
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.onDownScalingComplete = function (workersKeys) {
        var triggered = false;
        if (workersKeys != null && workersKeys.length > 0) {
            this.emit('down-scaled', workersKeys);
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.upScale = function (launchRequest) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.getUpScalePromise(launchRequest)
                .then(function (workersKeys) {
                resolve(_this.onUpScalingComplete(workersKeys));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.downScale = function (toBeTerminatedWorkers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.getDownScalePromise(toBeTerminatedWorkers)
                .then(function (workersKeys) {
                resolve(_this.onDownScalingComplete(workersKeys));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    // auto down-scaling logic
    GridAutoScaler.prototype.getAutoDownScalingPromise = function (state) {
        if (state.QueueEmpty) {
            var toBeTerminatedWorkers = [];
            var maxTerminateCount = (this.HasMinWorkersCap ? Math.max(state.WorkerStates.length - this.MinWorkersCap, 0) : null);
            for (var i in state.WorkerStates) {
                var ws = state.WorkerStates[i];
                if (!ws.Terminating && !ws.Busy && typeof ws.LastIdleTime === 'number') {
                    var elapseMS = state.CurrentTime - ws.LastIdleTime;
                    if (elapseMS > this.options.TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                        if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                            toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                    }
                }
            }
            return (toBeTerminatedWorkers.length > 0 ? this.getDownScalePromise(toBeTerminatedWorkers) : Promise.resolve(null));
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.getAutoUpScalingWithTaskDebtPromise = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.implementation.ComputeWorkersLaunchRequest(state) // compute the number of additional workers desired
                .then(function (launchRequest) {
                var numWorkersToLaunch = 0;
                if (_this.HasMaxWorkersCap) {
                    var workersAllowance = Math.max(_this.MaxWorkersCap - state.WorkerStates.length, 0); // number of workers stlll allowed to be launched under the cap
                    numWorkersToLaunch = Math.min(launchRequest.NumInstances, workersAllowance);
                }
                else
                    numWorkersToLaunch = launchRequest.NumInstances;
                if (numWorkersToLaunch > 0) {
                    _this.getUpScalePromise({ NumInstances: numWorkersToLaunch, Hint: launchRequest.Hint })
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
    // auto up-scaling logic
    GridAutoScaler.prototype.getAutoUpScalingPromise = function (state) {
        if (!state.QueueEmpty) {
            if (state.CPUDebt > 0)
                return this.getAutoUpScalingWithTaskDebtPromise(state);
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
                var someWorkersGotLaunched = false;
                if (_this.__launchingWorkers) {
                    var workers_1 = _this.LaunchingWorkers;
                    var launchedWorkers = [];
                    for (var i in workers_1) {
                        var workerKey = workers_1[i];
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
                if (someWorkersGotLaunched)
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
                        return Promise.all([_this.getAutoDownScalingPromise(state), _this.getAutoUpScalingPromise(state)]);
                    else
                        return Promise.resolve([null, null]);
                }).then(function (value) {
                    var triggered = (_this.onDownScalingComplete(value[0]) || _this.onUpScalingComplete(value[1]));
                    resolve(triggered);
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
            LaunchingWorkers: this.LaunchingWorkers
        };
    };
    return GridAutoScaler;
}(events.EventEmitter));
exports.GridAutoScaler = GridAutoScaler;
