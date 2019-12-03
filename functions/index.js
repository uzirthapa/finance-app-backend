/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable promise/no-nesting */
const functions = require('firebase-functions');
'use strict';
var envvar = require('envvar');
var plaid = require('plaid');
var moment = require('moment');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const cors = require('cors')({ origin: true });


const { Logging } = require('@google-cloud/logging');
// Creates a client
const logging = new Logging();


var PLAID_CLIENT_ID = envvar.string('PLAID_CLIENT_ID', "Your Client ID");
var PLAID_SECRET = envvar.string('PLAID_SECRET', "YOur Client Secret");
var PLAID_PUBLIC_KEY = envvar.string('PLAID_PUBLIC_KEY', "Your Public Key");
var PLAID_ENV = envvar.string('PLAID_ENV', 'sandbox');

var PUBLIC_TOKEN = null;
var ACCESS_TOKEN = null;
var ITEM_ID = null

var client = new plaid.Client(
    PLAID_CLIENT_ID,
    PLAID_SECRET,
    PLAID_PUBLIC_KEY,
    plaid.environments[PLAID_ENV],
    { version: '2019-05-29', clientApp: 'Plaid Quickstart' }
);

exports.createPlaidToken = functions.firestore.document('users/{userId}/tokens/{id}').onCreate(async (snap, context) => {
    const val = snap.data()
    try {
        // const snapshot = await admin.firestore().collection('tokens').doc(context.params.userId).get()
        // const snapval = snapshot.data();

        const token = val.token

        // Initialize the Plaid client
        // Find your API keys in the Dashboard (https://dashboard.plaid.com/account/keys)
        console.log("Getting Access token");
        PUBLIC_TOKEN = token
        let response = await client.exchangePublicToken(PUBLIC_TOKEN)
        console.log(response)
        console.log(context.params.id)

        response = extend(response, { id: context.params.id })
        console.log(response)


        return snap.ref.set(response, { merge: true });
    } catch (error) {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with StackDriver
        console.log(error);
        await snap.ref.set({ error: userFacingMessage(error) }, { merge: true });
        return reportError(error, { user: context.params.userId });
    }
})

function extend(obj, src) {
    for (var key in src) {
        if (src.hasOwnProperty(key)) obj[key] = src[key];
    }
    return obj;
}

exports.removeToken = functions.https.onRequest((request, resolve) => {
    var clientToken = request.query.token || "unknown"
    var clientInst = request.query.inst || "unknown"

    console.log(clientToken)
    console.log(clientInst)

    admin.auth().verifyIdToken(clientToken)
        .then(async (decodedToken) => {
            uid = decodedToken.user_id
            db.collection("users").doc(uid).collection("tokens").get().then((querySnapshot) => {
                querySnapshot.forEach((doc) => {
                    console.log(doc.data())
                    var docData = doc.data()
                    if (docData.institution.institution_id === clientInst) {
                        cors(request, resolve, () => {
                            client.removeItem(docData.access_token).then((res) => {
                                resolve.send(res.removed)
                                console.log("document Data", docData)
                                console.log("document Id", docData.id)
                                db.collection("users").doc(uid).collection("tokens").doc(docData.id).delete().then((res) => {
                                    db.collection("users").doc(uid).collection("institutions").doc(docData.id).delete().then((res) => {
                                        console.log("Institution successfully deleted!");
                                        return res
                                    }).catch((err) => {
                                        return err
                                    })
                                    console.log("Account successfully deleted!");
                                    return res
                                }).catch((err) => {
                                    console.error("Error removing document: ", err);
                                    return err
                                })
                                return res.removed
                            }).catch((err) => {
                                resolve.send(err)
                                return err
                            })
                        })
                    }

                })
                return
            }).catch((err) => {
                return err
            })
            return
        }).catch((err) => {
            return err
        })


})

exports.updateSharedStatus = functions.https.onRequest((request, resolve) => {
    var clientShareId = request.query.shareId || "unknown"
    var status = request.query.status || "unknown"

    console.log(clientShareId)
    console.log(status)

    var updateStatus = {}

    if (status === "true") {

        updateStatus = {
            pending: false,
            accepted: true,
            declined: false
        }
    } else if (status === "false") {
        updateStatus = {
            pending: false,
            accepted: false,
            declined: true
        }
    }



    db.collection("sharedProfiles").doc(clientShareId).get().then((doc) => {
        console.log(doc.data())
        console.log(updateStatus)
        db.collection("users").doc(doc.data().primaryUid).collection("shared").doc(clientShareId).update(updateStatus).then(() => {

            resolve.send("updated status to: ", updateStatus)
            return
        }).catch((err) => {
            resolve.send(err)
            return err
        })
        return
    }).catch((err) => {
        resolve.send(err)
        return err
    })
})

exports.sharedTransactionsV2 = functions.https.onRequest((request, resolve) => {
    var clientToken = request.query.token || "unknown"

    var startDate = moment().startOf('month').format('YYYY-MM-DD')
    var endDate = moment().format('YYYY-MM-DD');
    var sharedUsers = []
    var users = []

    var i = 0

    console.log("token: ", clientToken)


    admin.auth().verifyIdToken(clientToken)
        .then(async (decodedToken) => {
            uid = decodedToken.user_id
            console.log("Shared UID: ", uid)
            db.collection("users").doc(uid).collection("sharedRequests").where("accepted", "==", true).get().then((querySnapshot) => {
                querySnapshot.forEach((doc) => {
                    users.push(doc.data())
                })
                return
            }).catch((err) => {
                resolve.send(err)
                return err
            })

            db.collection("users").doc(uid).collection("sharedRequests").where("accepted", "==", true).get().then((querySnapshot) => {
                console.log("Snapshot: ", querySnapshot)



                querySnapshot.forEach((doc) => {

                    var transactions = []
                    console.log("snapshot data: ", doc.data())
                    var institutions = []
                    db.collection("users").doc(doc.data().uid).collection("institutions").get().then((querySnapshot1) => {
                        querySnapshot1.forEach((doc1) => {
                            institutions.push(doc1.data())
                        })
                        return
                    }).catch((err) => {
                        resolve.send(err)
                        return err
                    })

                    db.collection("users").doc(doc.data().uid).collection("tokens").get().then((querySnapshot2) => {
                        querySnapshot2.forEach((doc2) => {
                            console.log(doc2.data())
                            cors(request, resolve, () => {
                                console.log("inside cors")
                                client.getTransactions(doc2.data().access_token, startDate, endDate, {
                                    count: 250,
                                    offset: 0
                                })
                                    .then((response) => {
                                        console.log("transactions: --")
                                        console.log(response)
                                        transactions.push(response)
                                        if (institutions.length === transactions.length && institutions.length !== 0) {
                                            sharedUsers.push({
                                                user: doc.data().uid,
                                                name: doc.data().name,
                                                transactions: transactions
                                            })

                                            console.log("sharedTransactions inside: ", transactions)
                                        }
                                        console.log("users Length: ", users.length)
                                        console.log("sharedUsers Length: ", sharedUsers.length)
                                        if (users.length === sharedUsers.length && users.length !== 0) {
                                            resolve.send(sharedUsers)
                                        }
                                        return response
                                    })
                                    .catch((err) => {
                                        console.log(err)
                                        resolve.send(err)
                                        return err
                                    })

                            })

                        })
                        // if (users.length === sharedUsers.length && users.length !== 0) {
                        //     resolve.send(sharedUsers)
                        // }

                        console.log("sharedUsers: ", sharedUsers)
                        return
                    }).catch((err) => {
                        resolve.send(err)
                        console.log(err)
                    })
                    i++
                })


                return

            }).catch((err) => {
                resolve.send(err)
                return err
            })
            return
        }).catch((err) => {
            resolve.send(err)
            return err
        })

})


async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        return await callback(array[index], index, array);
    }
    return 0
}

exports.transactionsV2 = functions.https.onRequest((request, resolve) => {
    var clientToken = request.query.token || "unknown"
    var clientInst = request.query.inst || "unknown"
    var start = request.query.start || "unknown"
    var end = request.query.end || "unknown"

    var startDate = null
    var endDate = null

    var uid = null
    var access_token = null



    if (start !== "unknown" && end !== "unknown") {
        startDate = start
        endDate = end
    } else {
        startDate = moment().startOf('month').format('YYYY-MM-DD')
        endDate = moment().format('YYYY-MM-DD');
    }

    console.log("startDate: ", startDate)
    console.log("endDate: ", endDate)
    console.log(clientToken)
    console.log(clientInst)

    admin.auth().verifyIdToken(clientToken)
        .then((decodedToken) => {
            uid = decodedToken.user_id
            console.log(uid)
            // access_token = await getAccessToken(uid, clientInst)
            db.collection("users").doc(uid).collection("tokens").doc(clientInst).get().then((doc) => {
                console.log("fetch Access Tokens")
                if (doc.exists) {
                    console.log(doc.data())
                    access_token = doc.data().access_token
                    console.log(access_token)
                    cors(request, resolve, () => {
                        console.log("inside cors")
                        client.getTransactions(access_token, startDate, endDate, {
                            count: 250,
                            offset: 0
                        })
                            .then((response) => {
                                console.log("transactions: --")
                                console.log(response)
                                resolve.send(response)
                                return response
                            }).catch((err) => {
                                console.log(err)
                                resolve.send(err)
                                return err
                            })
                    })
                } else {
                    resolve.send("No such document!")
                    console.log("No such document!");
                }

                return
            }).catch((err) => {
                console.log(err)
                resolve.send(err)
                return err
            })


            return
        }).catch((err) => {
            console.log(err)
            resolve.send(err)
            return err
        })

})

exports.balance = functions.https.onRequest((req, res) => {
    var clientToken = req.query.token || "unknown"
    var clientInst = req.query.inst || "unknown"
    var uid = null
    var access_token = null

    admin.auth().verifyIdToken(clientToken)
        .then((decodedToken) => {
            uid = decodedToken.user_id
            console.log(uid)

            db.collection("users").doc(uid).collection("tokens").doc(clientInst).get().then((doc) => {
                console.log("fetch Access Tokens")
                if (doc.exists) {
                    console.log(doc.data())
                    access_token = doc.data().access_token
                    console.log(access_token)
                    cors(req, res, () => {
                        client.getBalance(access_token).then((result) => {
                            res.send(result)
                            return
                        }).catch((err) => {
                            res.send(err)
                            return err
                        })
                    })


                    // res.send()
                } else {
                    res.send("No such document!")
                    console.log("No such document!");
                }

                return
            }).catch((err) => {
                return err
            })

            return

        }).catch((err) => {
            return err
        })

})


exports.linkShared = functions.firestore.document('users/{userId}/shared/{sharedId}').onCreate((snap, context) => {
    console.log(context.params.userId)

    const val = snap.data()
    console.log(val)
    var i = 0
    db.collection("users").where('email', '==', val.email.toLowerCase()).get().then((querySnapshot) => {
        querySnapshot.forEach((doc) => {

            if (i === 0) {
                snap.ref.set({ uid: doc.data().id }, { merge: true }).then(() => {
                    db.collection("users").doc(doc.data().id).collection("sharedRequests").doc(val.id).set({
                        email: val.email,
                        id: val.id,
                        name: val.primaryName,
                        primaryEmail: val.primaryEmail,
                        pending: true,
                        accepted: false,
                        declined: false,
                        uid: context.params.userId
                    })
                        .then((res) => {
                            return res
                        })
                        .catch((err) => {
                            snap.ref.set({ error: userFacingMessage(err) }, { merge: true });
                            return err
                        })
                    return "good"

                }).catch((err) => {
                    snap.ref.set({ error: userFacingMessage(err) }, { merge: true });
                    return err
                })
            }

            i++
        })

        return
    }).catch((err) => {
        console.log(err)
        return err
    })
})

exports.totalAvg = functions.https.onRequest((res, req) => {
    db.collection("users")
})

// exports.income = functions.https.onRequest((req, res) => {
//     var accessToken = req.query.token || "unknown"
//     cors(req, res, () => {
//         client.getIncome(accessToken).then((result) => {
//             console.log(result)
//             res.send(result)
//             return res
//         }).catch((err) => {
//             console.log(err)
//             res.send(err)
//             return err
//         })
//     })
// })

// async function getAccessToken(uid, clientInst) {

//     var data = await db.collection("users").doc(uid).collection("tokens").doc(clientInst).get().then((doc) => {
//         console.log("fetch Access Tokens")
//         var accessToken = null
//         accessToken = doc.data().access_token
//         // querySnapshot.forEach((doc) => {
//         //     if (doc.data().clientInst === clientInst) {
//         //         accessToken = doc.data().access_token
//         //     }
//         // })

//         return accessToken
//     })
//         .catch((err) => {
//             console.log(err)
//             return err
//         })
//     return Promise.all(data)
// }



// Sanitize the error message for the user
function userFacingMessage(error) {
    return error.type ? error.message : 'An error occurred, developers have been alerted';
}

function reportError(err, context = {}) {
    // This is the name of the StackDriver log stream that will receive the log
    // entry. This name can be any valid log stream name, but must contain "err"
    // in order for the error to be picked up by StackDriver Error Reporting.
    const logName = 'errors';
    const log = logging.log(logName);

    // https://cloud.google.com/logging/docs/api/ref_v2beta1/rest/v2beta1/MonitoredResource
    const metadata = {
        resource: {
            type: 'cloud_function',
            labels: { function_name: process.env.FUNCTION_NAME },
        },
    };

    // https://cloud.google.com/error-reporting/reference/rest/v1beta1/ErrorEvent
    const errorEvent = {
        message: err.stack,
        serviceContext: {
            service: process.env.FUNCTION_NAME,
            resourceType: 'cloud_function',
        },
        context: context,
    };

    // Write the error log entry
    return new Promise((resolve, reject) => {
        log.write(log.entry(metadata, errorEvent), (error) => {
            if (error) {
                return reject(error);
            }
            return resolve();
        });
    });
}


// exports.transactions = functions.https.onRequest((req, res) => {
//     var idToken = req.query.token || "unknown";
//     var uid = null;
//     var accessToken = null;
//     var allTransactions = null



//     admin.auth().verifyIdToken(idToken)
//         .then(async (decodedToken) => {
//             uid = decodedToken.uid
//             console.log(uid)

//             accessToken = await getAccessTokens(uid)

//             console.log(accessToken)

//             cors(req, res, async () => {
//                 client.getTransactions(access_token, startDate, endDate, {
//                     count: 250,
//                     offset: 0
//                 })
//                     .then((response) => {
//                         console.log("transactions: --")
//                         console.log(response)
//                         // res.send(response)
//                         transactions.push(response)
//                         return response
//                     }).catch((err) => {
//                         console.log(err)
//                         // res.send(err)
//                         return err
//                     })
//                 res.send(allTransactions)
//             })
//             return
//         })

//         .catch((err) => {
//             console.log(err)
//             res.send(err)
//             return
//         })

// })



// async function getTransactions(accessTokensArray) {
//     var startDate = moment().startOf('month').format('YYYY-MM-DD')
//     var endDate = moment().format('YYYY-MM-DD');
//     var transactions = null
//     var access = null
//     var tokenTransactions = null

//     console.log("Get transactions Function")

//     accessTokensArray.forEach(async (access_token) => {
//         console.log("Got Access token: ", access_token)
//         transactions.push(await )

//         console.log("each: ", transactions)


//         // transactions.push(tokenTransactions)

//     })
//     console.log("all Trans: ", transactions)


//     // return transactions



//     // })

//     return Promise.all(transactions)
// }
